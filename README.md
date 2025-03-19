# OpenRouter-to-Ollama Proxy

This Node.js proxy bridges OpenRouter's API to tools expecting an Ollama server, such as Open-WebUI. It translates OpenRouter's OpenAI-compatible endpoints (e.g., `/v1/chat/completions`, `/v1/models`) into Ollama's API format (e.g., `/api/chat`, `/api/tags`), enabling seamless use of OpenRouter's models within Ollama-compatible clients.

**Hybrid Local/OpenRouter Functionality:** This proxy addresses the challenge of OpenRouter's lack of native embedding endpoint support. It allows for a hybrid setup where embedding requests (`/api/embeddings`) and models listed in the `localModels` configuration will bypass OpenRouter and be handled by a local Ollama server running on port `11435`. This is particularly useful for tools like Weaviate's local setup ([https://weaviate.io/developers/weaviate/quickstart/local](https://weaviate.io/developers/weaviate/quickstart/local)) which require local Ollama compatibility for embeddings, even when your hardware limitations prevent running large language models locally for chat. You can continue to use OpenRouter for chat and other tasks, while relying on local Ollama for embedding models and other specified local models.

## Features

* Proxies OpenRouter's `/v1/chat/completions` to Ollama's `/api/chat`, supporting both streaming and non-streaming requests.
* Maps OpenRouter's `/v1/models` to Ollama's `/api/tags` for model listing.
* **Bypass for Embeddings:** All requests to `/api/embeddings` are handled by a local Ollama server.
* **Bypass for Listed Models:** Models specified in the `localModels` configuration are handled by a local Ollama server.
* Includes detailed logging for debugging.
* Configurable via an `.env` file for your OpenRouter API key.

## Prerequisites

* **Node.js:** Version 16 or higher (tested with v22.13.0).
* **npm:** Comes with Node.js for installing dependencies.
* **OpenRouter Account:** Obtain an API key from OpenRouter.
* **Local Ollama Server (Optional):** If you intend to use local models for embeddings or bypass-listed models, ensure you have Ollama running on `http://localhost:11435`.

## Installation

Follow these steps to set up the proxy locally:

1.  **Clone the Repository**

    ```bash
    git clone https://github.com/gagin/openrouter-to-ollama-proxy.git
    cd openrouter-to-ollama-proxy
    ```

2.  **Install Dependencies**

    Install the required Node.js packages:

    ```bash
    npm install express axios dotenv
    ```

3.  **Configure Environment Variables**

    Create an `.env` file in the project root with your OpenRouter API key:

    ```bash
    echo "OPENROUTER_API_KEY=your-api-key-here" > .env
    ```

    Replace `your-api-key-here` with your key from OpenRouter's dashboard. Keep this file private—it's excluded via `.gitignore`.

4.  **Run the Proxy**

    Start the proxy server:

    ```bash
    node proxy.js
    ```

    You'll see:

    ```
    Proxy running on port 11434
    ```

    The proxy listens on `http://localhost:11434`, emulating an Ollama server.

## Local Ollama Server Setup (Optional)

If you intend to use local models for embeddings or bypass-listed models, you need to have a local Ollama server running on port `11435`. Here's how you can set it up:

1.  **Create a Script:**
    Create a script named `run-ollama-on-11435.sh` in the project root directory.

2.  **Add the Following Content:**

    ```bash
    #!/bin/bash
    OLLAMA_HOST=0.0.0.0:11435 ollama serve
    ```

3.  **Run the Script:**

    ```bash
    bash run-ollama-on-11435.sh
    ```

    This will start the Ollama server on `0.0.0.0:11435`, making it accessible to the proxy.

**Important:** Ensure you have Ollama installed and configured correctly before running this script.

**Important:** If you intend to use the `nomic-embed-text` embedding model locally, you must first pull it using the following command:

```bash
ollama pull nomic-embed-text
```

## Usage and Testing

### Automated Testing

The repository includes a test script (`test.js`) that verifies both the embedding and chat endpoints:

```bash
npm install axios
node test.js
```

This script performs:
1. An embedding model test using the semantic analogy "queen - female + male ≈ king"
2. A chat model test that analyzes the embedding results

You can configure the test by modifying these variables at the top of `test.js`:
- `embeddingModel`: The model to use for embeddings (default: `nomic-embed-text`)
- `geminiModel`: The chat model to test (default: `google/gemini-2.0-flash-lite-001`)
- `useStreaming`: Toggle between streaming and non-streaming responses (default: `true`)

### Manual Testing

#### List Models

```bash
curl http://localhost:11434/api/tags
```

Returns OpenRouter's model list in Ollama's format.

#### Non-Streaming Chat

```bash
curl -X POST http://localhost:11434/api/chat \
     -H "Content-Type: application/json" \
     -d '{"model": "google/gemini-2.0-flash-001:latest", "messages": [{"role": "user", "content": "Hello"}]}'
```

#### Streaming Chat

```bash
curl -X POST http://localhost:11434/api/chat \
     -H "Content-Type: application/json" \
     -d '{"model": "google/gemini-2.0-flash-001:latest", "messages": [{"role": "user", "content": "Are there any fountains?"}], "stream": true}'
```

#### Embedding Request (Local Ollama)

```bash
curl -X POST http://localhost:11434/api/embeddings \
     -H "Content-Type: application/json" \
     -d '{"model": "nomic-embed-text:latest", "prompt": "Test embedding"}'
```

### Integrating with Open-WebUI

To use OpenRouter models within Open-WebUI:

1. Ensure your Open-WebUI instance can access `http://localhost:11434` or `http://host.docker.internal:11434` (if running in Docker).
2. The model list in Open-WebUI should then display the list of models available from OpenRouter.

## Local Models Bypass

To use local models for specific chat models, modify the `localModels` object in `proxy.js`. For example:

```javascript
const localModels = {
  chat: [
    'gemma3:1b',
    'SmolLM2:135m',
    'deepseek-r1:1.5b'
  ],
  embeddings: ['nomic-embed-text:latest'],
};
```

Any chat requests for `gemma3:1b`, `SmolLM2:135m`, or `deepseek-r1:1.5b` will be routed to your local Ollama server running on port 11435. All requests to `/api/embeddings` will also be routed locally.

**Note:** If you are using local models, make sure you have pulled them using `ollama pull model_name` before running the proxy.

## Troubleshooting

* **Proxy Logs:** Check the terminal running `node proxy.js` for request/response details.
* **Open-WebUI Errors:** View logs with `docker logs open-webui`.
* **Port Conflict:** If 11434 is taken, identify and stop the conflicting service. If Ollama is running and you need to stop it, use the appropriate method for your system, as `killall ollama` might not prevent automatic restarts.
* **API Key Issues:** Ensure `OPENROUTER_API_KEY` in `.env` is valid.
* **Local Ollama Issues:** If using local models, ensure your Ollama server is running on port 11435 and the specified models are available.

## Notes

* **Streaming:** Streaming responses from OpenRouter are aggregated into a single JSON object. True SSE streaming to the client isn't implemented but can be added if needed.
* **Model Names:** `:latest` is appended to model IDs for Ollama compatibility and stripped before sending to OpenRouter.
