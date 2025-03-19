require('dotenv').config();
const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const localOllamaUrl = 'http://localhost:11435';
const localModels = {
  chat: [
    'nomic-embed-text:latest',
    'gemma3:1b',
    'SmolLM2:135m',
    'deepseek-r1:1.5b'
  ],
  embeddings: ['nomic-embed-text:latest'],
};

function shouldBypass(modelName, endpoint) {
  return localModels[endpoint] && localModels[endpoint].includes(modelName);
}

async function forwardToOllama(req, res, endpoint) {
  try {
    const localResponse = await axios.post(`${localOllamaUrl}/${endpoint}`, req.body, {
      responseType: 'stream',
    });

    let responseData = '';
    let isStreaming = false;

    localResponse.data.on('data', (chunk) => {
      const chunkString = chunk.toString();
      responseData += chunkString;

      if (!isStreaming) {
        try {
          JSON.parse(responseData);
        } catch (jsonError) {
          if (chunkString.includes('\n')) {
            isStreaming = true;
          }
        }
      }

      if (isStreaming) {
        const lines = responseData.split('\n').filter(line => line.trim() !== '');
        responseData = '';
        lines.forEach(line => {
          try {
            const parsed = JSON.parse(line);
            res.write(JSON.stringify(parsed) + '\n'); // Add newline here
          } catch (error) {
            if(line.trim() !== ''){
                res.write(JSON.stringify({response: line}) + '\n'); // Add newline here
            }
          }
        });
      }
    });

    localResponse.data.on('end', () => {
      if (!isStreaming) {
        try {
          const parsed = JSON.parse(responseData);
          res.json(parsed);
        } catch (error) {
          res.json({response: responseData});
        }
      } else {
        res.end();
      }
    });

    localResponse.data.on('error', (error) => {
      console.error('Error in Ollama response:', error);
      res.status(500).json({ error: 'Error processing Ollama response' });
    });

  } catch (localError) {
    console.error(`Error forwarding to local Ollama ${endpoint}:`, localError.message);
    if (localError.response) {
      console.error(`Local Ollama ${endpoint} response:`, JSON.stringify(localError.response.data, null, 2));
      if (localError.response.status === 404 && localError.response.data && localError.response.data.error && localError.response.data.error.includes("model")) {
        return res.status(400).json({ error: `Model "${req.body.model}" not found on Ollama server.` });
      }
    } else if (localError.code === 'ECONNREFUSED') {
      return res.status(503).json({ error: 'Ollama server unavailable' });
    }
    res.status(500).json({ error: `Error forwarding to local Ollama ${endpoint}` });
  }
}

async function forwardToOpenRouter(req, res, endpoint) {
  try {
    const openRouterRequest = {
      ...req.body,
      model: req.body.model ? req.body.model.replace(':latest', '') : undefined,
    };

    if (endpoint === 'api/chat' && req.body.stream) {
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
        console.log(`Sending ${endpoint} response (streamed):`, JSON.stringify(ollamaResponse, null, 2));
        res.json(ollamaResponse);
      });

      streamResponse.data.on('error', (error) => {
        console.error('Error in stream:', error.message);
        res.status(500).json({ error: `Error processing stream: ${error.message}` });
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
      console.log(`Sending ${endpoint} response:`, JSON.stringify(ollamaResponse, null, 2));
      res.json(ollamaResponse);
    }
  } catch (openRouterError) {
    console.error(`Error forwarding to OpenRouter ${endpoint}:`, openRouterError.message);
    if (openRouterError.response) {
      console.error(`Openrouter ${endpoint} response:`, JSON.stringify(openRouterError.response.data, null, 2));
      let errorMessage = openRouterError.response.data.error;
      if (typeof errorMessage === 'object' && errorMessage !== null) {
        errorMessage = JSON.stringify(errorMessage);
      }
      return res.status(500).json({ error: `Error forwarding to OpenRouter ${endpoint}: ${errorMessage || openRouterError.message}` });
    }
    return res.status(500).json({ error: `Error forwarding to OpenRouter ${endpoint}: ${openRouterError.message}` });
  }
}

function handleRoute(req, res, endpoint) {
  console.log(`Received ${endpoint} request:`, JSON.stringify(req.body, null, 2));
  try {
    if (endpoint === 'api/embeddings') {
      forwardToOllama(req, res, endpoint);
    } else if (req.body.model && shouldBypass(req.body.model, endpoint.split('/')[1])) {
      forwardToOllama(req, res, endpoint);
    } else {
      forwardToOpenRouter(req, res, endpoint);
    }
  } catch (error) {
    console.error(`General error in ${endpoint}:`, error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

app.post('/api/chat', (req, res) => handleRoute(req, res, 'api/chat'));
app.post('/v1/chat/completions', (req, res) => handleRoute(req, res, 'v1/chat/completions'));
app.post('/api/embeddings', (req, res) => handleRoute(req, res, 'api/embeddings'));

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