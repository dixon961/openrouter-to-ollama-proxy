require('dotenv').config();
const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const localOllamaUrl = 'http://localhost:11435';
const localModels = {
  chat: [],
  embeddings: ['nomic-embed-text'],
};

function shouldBypass(modelName, endpoint) {
  return localModels[endpoint].includes(modelName);
}

app.post('/api/chat', async (req, res) => {
  console.log('Received /api/chat request:', JSON.stringify(req.body, null, 2));
  try {
    if (!req.body.model || !req.body.messages || !Array.isArray(req.body.messages) || req.body.messages.length === 0) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    if (shouldBypass(req.body.model, 'chat')) {
      try {
        const localResponse = await axios.post(`${localOllamaUrl}/api/chat`, req.body);
        console.log('Sending /api/chat response (local):', JSON.stringify(localResponse.data, null, 2));
        res.json(localResponse.data);
      } catch (localError) {
        console.error('Error forwarding to local Ollama:', localError.message);
        if (localError.response) {
          console.error('Local Ollama response:', JSON.stringify(localError.response.data, null, 2));
        }
        res.status(500).json({ error: 'Error forwarding to local Ollama' });
      }
    } else {
      const openRouterRequest = {
        model: req.body.model.replace(':latest', ''),
        messages: req.body.messages,
        stream: req.body.stream || false,
      };

      try {
        if (openRouterRequest.stream) {
          const streamResponse = await axios({
            method: 'post',
            url: 'https://openrouter.ai/api/v1/chat/completions',
            data: openRouterRequest,
            headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
            responseType: 'stream',
          });

          let fullContent = '';
          streamResponse.data.on('data', (chunk) => {
            const lines = chunk.toString().split('\n').filter((line) => line.trim());
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6);
                if (data === '[DONE]') continue;
                try {
                  const parsed = JSON.parse(data);
                  if (parsed.choices && parsed.choices[0].delta && parsed.choices[0].delta.content) {
                    fullContent += parsed.choices[0].delta.content;
                  }
                } catch (e) {
                  console.error('Error parsing stream chunk:', e.message);
                }
              }
            }
          });

          streamResponse.data.on('end', () => {
            const ollamaResponse = {
              model: req.body.model,
              created_at: new Date().toISOString(),
              message: { role: 'assistant', content: fullContent || 'No content returned' },
              done: true,
            };
            console.log('Sending /api/chat response (streamed):', JSON.stringify(ollamaResponse, null, 2));
            res.json(ollamaResponse);
          });

          streamResponse.data.on('error', (error) => {
            console.error('Error in stream:', error.message);
            res.status(500).json({ error: 'Error processing stream' });
          });
        } else {
          const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', openRouterRequest, {
            headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
          });

          if (!response.data.choices || !Array.isArray(response.data.choices) || response.data.choices.length === 0) {
            return res.status(500).json({ error: 'No valid choices in OpenRouter response' });
          }

          const ollamaResponse = {
            model: req.body.model,
            created_at: new Date().toISOString(),
            message: { role: 'assistant', content: response.data.choices[0].message.content || 'No content returned' },
            done: true,
          };
          console.log('Sending /api/chat response:', JSON.stringify(ollamaResponse, null, 2));
          res.json(ollamaResponse);
        }
      } catch (openRouterError) {
        console.error('Error forwarding to OpenRouter:', openRouterError.message);
        if (openRouterError.response) {
          console.error('Openrouter response:', JSON.stringify(openRouterError.response.data, null, 2));
        }
        res.status(500).json({ error: 'Error forwarding to OpenRouter' });
      }
    }
  } catch (error) {
    console.error('General error in /api/chat:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/v1/chat/completions', async (req, res) => {
  console.log('Received /v1/chat/completions request:', JSON.stringify(req.body, null, 2));
  try {
    if (req.body.model && shouldBypass(req.body.model, 'chat')) {
      try {
        const localResponse = await axios.post(`${localOllamaUrl}/v1/chat/completions`, req.body);
        console.log('Sending /v1/chat/completions response (local):', JSON.stringify(localResponse.data, null, 2));
        res.json(localResponse.data);
      } catch (localError) {
        console.error('Error forwarding to local Ollama:', localError.message);
        if (localError.response) {
          console.error('Local Ollama response:', JSON.stringify(localError.response.data, null, 2));
        }
        res.status(500).json({ error: 'Error forwarding to local Ollama' });
      }
    } else {
      try {
        const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', req.body, {
          headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
        });
        console.log('Response from OpenRouter:', JSON.stringify(response.data, null, 2));
        res.json(response.data);
      } catch (openRouterError) {
        console.error('Error forwarding to OpenRouter:', openRouterError.message);
        if (openRouterError.response) {
          console.error('Openrouter response:', JSON.stringify(openRouterError.response.data, null, 2));
        }
        res.status(500).json({ error: 'Error forwarding to OpenRouter' });
      }
    }
  } catch (error) {
    console.error('General error in /v1/chat/completions:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/embeddings', async (req, res) => {
  console.log('Received /api/embeddings request:', JSON.stringify(req.body, null, 2));
  try {
    if (req.body.model && shouldBypass(req.body.model, 'embeddings') || true) {
      await forwardToOllama(req, res, 'api/embeddings'); // Replace existing logic
    } else {
      res.status(400).json({ error: 'OpenRouter does not support embeddings' });
    }
  } catch (error) {
    console.error('General error in /api/embeddings:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/tags', async (req, res) => {
  console.log('Received /api/tags request');
  try {
    const response = await axios.get('https://openrouter.ai/api/v1/models', {
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
    });
    const openRouterModels = {
      models: response.data.data.map((model) => ({
        model: `${model.id}:latest`,
        name: model.name || model.id,
        modified_at: '2025-02-27T00:00:00Z',
        size: 0,
        digest: 'n/a',
      })),
    };
    console.log('Sending /api/tags response:', JSON.stringify(openRouterModels, null, 2));
    res.json(openRouterModels);
  } catch (error) {
    console.error('Error fetching models from OpenRouter:', error.message);
    res.status(500).send('Failed to fetch models from OpenRouter');
  }
});

app.get('/', (req, res) => {
  console.log('Received root endpoint request');
  res.send('Proxy is running');
});

app.listen(11434, () => console.log('Proxy running on port 11434'));