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
  // Strip the :latest suffix for comparison
  const cleanModelName = modelName.replace(':latest', '');
  const modelList = localModels[endpoint] || [];
  
  // Check both with and without :latest suffix for better matching
  return modelList.some(m => m === modelName || m === cleanModelName || 
                            m.replace(':latest', '') === cleanModelName);
}

async function forwardToOllama(req, res, endpoint) {
  try {
    console.log(`Forwarding to local Ollama ${endpoint} for model: ${req.body.model}`);
    
    const isStreaming = req.body.stream === true;
    const localResponse = await axios.post(`${localOllamaUrl}/${endpoint}`, req.body, {
      responseType: 'stream',
    });

    let responseData = '';
    let streamingStarted = false;

    localResponse.data.on('data', (chunk) => {
      const chunkString = chunk.toString();
      
      if (isStreaming) {
        const lines = chunkString.split('\n').filter(line => line.trim() !== '');
        lines.forEach(line => {
          try {
            const parsed = JSON.parse(line);
            res.write(JSON.stringify(parsed) + '\n');
            streamingStarted = true;
          } catch (error) {
            if (line.trim() !== '') {
              res.write(JSON.stringify({response: line}) + '\n');
              streamingStarted = true;
            }
          }
        });
      } else {
        responseData += chunkString;
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
      } else if (streamingStarted) {
        res.end();
      } else {
        res.json({
          model: req.body.model,
          created_at: new Date().toISOString(),
          message: { role: 'assistant', content: 'No content returned' },
          done: true
        });
      }
    });

    localResponse.data.on('error', (error) => {
      console.error(`Local Ollama ${endpoint} error [500]:`, error.message);
      res.status(500).json({ error: 'Error processing Ollama response' });
    });

  } catch (localError) {
    const errorMsg = localError.response?.data?.error || localError.message || 'Unknown error';
    if (localError.response) {
      const status = localError.response.status;
      if (status === 404 || (errorMsg && errorMsg.includes("model"))) {
        console.error(`Local Ollama ${endpoint} error [404]: Model not found`);
        return res.status(404).json({ error: `Model "${req.body.model}" not found on Ollama server` });
      }
      console.error(`Local Ollama ${endpoint} error [${status}]:`, errorMsg);
      return res.status(status || 500).json({ error: errorMsg || 'Ollama server error' });
    } else if (localError.code === 'ECONNREFUSED') {
      console.error(`Local Ollama ${endpoint} error [503]: Server unavailable`);
      return res.status(503).json({ error: 'Ollama server unavailable' });
    } else if (localError.code === 'ECONNRESET' || localError.message.includes('socket hang up')) {
      console.error(`Local Ollama ${endpoint} error [404]: Model not found or server error`);
      return res.status(404).json({ error: `Model "${req.body.model}" not found on Ollama server or server error` });
    }
    console.error(`Local Ollama ${endpoint} error [500]:`, errorMsg);
    return res.status(500).json({ error: `Error forwarding to local Ollama ${endpoint}: ${errorMsg}` });
  }
}

async function forwardToOpenRouter(req, res, endpoint) {
  const isStreaming = req.body.stream === true;

  try {
    const modelName = req.body.model ? req.body.model.replace(':latest', '') : undefined;
    console.log(`Forwarding to OpenRouter for model: ${modelName}`);
    
    const openRouterRequest = {
      ...req.body,
      model: modelName,
    };

    if (isStreaming) {
      const streamResponse = await axios({
        method: 'post',
        url: 'https://openrouter.ai/api/v1/chat/completions',
        data: openRouterRequest,
        headers: { 
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json'
        },
        responseType: 'stream',
      });

      streamResponse.data.on('data', (chunk) => {
        const lines = chunk.toString().split('\n').filter((line) => line.trim());
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              const doneMessage = { model: req.body.model, done: true };
              res.write(JSON.stringify(doneMessage) + '\n');
              continue;
            }
            try {
              const parsed = JSON.parse(data);
              if (parsed.choices && parsed.choices[0].delta) {
                const ollamaChunk = {
                  model: req.body.model,
                  created_at: new Date().toISOString(),
                  message: {
                    role: 'assistant',
                    content: parsed.choices[0].delta.content || ''
                  },
                  done: false
                };
                res.write(JSON.stringify(ollamaChunk) + '\n');
              }
            } catch (e) {
              console.error('Error parsing stream chunk:', e.message);
            }
          }
        }
      });

      streamResponse.data.on('end', () => res.end());
      streamResponse.data.on('error', (error) => {
        console.error('Error in stream:', error.message);
        res.status(500).json({ error: `Error processing stream: ${error.message}` });
      });
    } else {
      const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', openRouterRequest, {
        headers: { 
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json'
        },
      });

      if (!response.data.choices || !Array.isArray(response.data.choices) || response.data.choices.length === 0) {
        return res.status(500).json({ error: 'No valid choices in OpenRouter response' });
      }

      const ollamaResponse = {
        model: req.body.model,
        created_at: new Date().toISOString(),
        message: { 
          role: 'assistant', 
          content: response.data.choices[0].message.content || 'No content returned' 
        },
        done: true,
      };
      res.json(ollamaResponse);
    }
  } catch (openRouterError) {
    console.error(`Error forwarding to OpenRouter ${endpoint}:`, openRouterError.message);
    if (openRouterError.response) {
      const responseData = openRouterError.response.data;
      const errorDetail = responseData?.error || responseData?.message || 'Unknown error';
      
      // Concise logging: status and error message only
      console.error(`OpenRouter ${endpoint} error [${openRouterError.response.status}]:`, errorDetail);

      const status = openRouterError.response.status;
      if (status === 400 || status === 404) {
        const errorResponse = { 
          error: `Model "${req.body.model}" not found on OpenRouter` 
        };
        if (isStreaming) {
          res.write(JSON.stringify({
            model: req.body.model,
            created_at: new Date().toISOString(),
            message: { role: 'assistant', content: errorResponse.error },
            done: true
          }) + '\n');
          res.end();
        } else {
          res.status(404).json(errorResponse);
        }
        return;
      }

      const detailedError = typeof errorDetail === 'object' ? JSON.stringify(errorDetail) : errorDetail;
      if (isStreaming) {
        res.write(JSON.stringify({
          model: req.body.model,
          created_at: new Date().toISOString(),
          message: { role: 'assistant', content: `OpenRouter error: ${detailedError}` },
          done: true
        }) + '\n');
        res.end();
      } else {
        res.status(status || 500).json({ error: `OpenRouter error: ${detailedError}` });
      }
      return;
    }
    const networkError = openRouterError.code === 'ECONNREFUSED' || openRouterError.message.includes('socket hang up')
      ? 'OpenRouter server unavailable'
      : `Error forwarding to OpenRouter ${endpoint}: ${openRouterError.message}`;
    console.error(`OpenRouter ${endpoint} network error:`, networkError);
    if (isStreaming) {
      res.write(JSON.stringify({
        model: req.body.model,
        created_at: new Date().toISOString(),
        message: { role: 'assistant', content: networkError },
        done: true
      }) + '\n');
      res.end();
    } else {
      res.status(503).json({ error: networkError });
    }
  }
}

function handleRoute(req, res, endpoint) {
  console.log(`Received ${endpoint} request:`, JSON.stringify(req.body, null, 2));
  
  try {
    // Extract the base endpoint type (chat, embeddings)
    const baseEndpoint = endpoint.split('/').pop();
    
    if (baseEndpoint === 'embeddings') {
      // All embedding requests go to local Ollama
      forwardToOllama(req, res, 'api/embeddings');
    } else if (req.body.model && shouldBypass(req.body.model, 'chat')) {
      // Model is in the bypass list, send to local Ollama
      forwardToOllama(req, res, 'api/chat');
    } else {
      // Otherwise, send to OpenRouter
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