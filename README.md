# OpenRouter-to-Ollama Proxy

This Node.js proxy bridges OpenRouter’s API to tools expecting an Ollama server, such as Open-WebUI. It translates OpenRouter’s OpenAI-compatible endpoints (e.g., `/v1/chat/completions`, `/v1/models`) into Ollama’s API format (e.g., `/api/chat`, `/api/tags`), enabling seamless use of OpenRouter’s models within Ollama-compatible clients.

## Features

* Proxies OpenRouter’s `/v1/chat/completions` to Ollama’s `/api/chat`, supporting both streaming and non-streaming requests.
* Maps OpenRouter’s `/v1/models` to Ollama’s `/api/tags` for model listing.
* Includes detailed logging for debugging.
* Configurable via an `.env` file for your OpenRouter API key.

## Prerequisites

* **Node.js:** Version 16 or higher (tested with v22.13.0).
* **npm:** Comes with Node.js for installing dependencies.
* **OpenRouter Account:** Obtain an API key from OpenRouter.

## Installation

Follow these steps to set up the proxy locally:

1.  **Clone the Repository**

    ```bash
    git clone [https://github.com/yourusername/openrouter-to-ollama-proxy.git](https://www.google.com/search?q=https://github.com/yourusername/openrouter-to-ollama-proxy.git)
    cd openrouter-to-ollama-proxy
    ```

    Replace `yourusername` with your GitHub username.

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

    Replace `your-api-key-here` with your key from OpenRouter’s dashboard. Keep this file private—it’s excluded via `.gitignore`.

4.  **Run the Proxy**

    Start the proxy server:

    ```bash
    node proxy.js
    ```

    You’ll see:

    ```
    Proxy running on port 11434
    ```

    The proxy listens on `http://localhost:11434`, emulating an Ollama server.

## Usage

### Testing the Proxy

* **List Models:**

    ```bash
    curl http://localhost:11434/api/tags
    ```

    Returns OpenRouter’s model list in Ollama’s format.

* **Non-Streaming Chat:**

    ```bash
    curl -X POST http://localhost:11434/api/chat \
         -H "Content-Type: application/json" \
         -d '{"model": "google/gemini-2.0-flash-001:latest", "messages": [{"role": "user", "content": "Hello"}]}'
    ```

* **Streaming Chat:**

    ```bash
    curl -X POST http://localhost:11434/api/chat \
         -H "Content-Type: application/json" \
         -d '{"model": "google/gemini-2.0-flash-001:latest", "messages": [{"role": "user", "content": "Are there any fountains?"}], "stream": true}'
    ```

### Integrating with Open-WebUI

1.  **Run Open-WebUI in Docker:**

    ```bash
    docker run -d -p 3000:8080 --add-host=host.docker.internal:host-gateway -v open-webui:/app/backend/data --name open-webui --restart always ghcr.io/open-webui/open-webui:main
    ```

2.  Open `http://localhost:3000` in your browser.
3.  Navigate to **Settings > Model Provider**.
4.  Set the **Base URL** to `http://host.docker.internal:11434`.
5.  Save and reload the page. The model dropdown will list OpenRouter models.
6.  Select a model and start chatting!

## Troubleshooting

* **Proxy Logs:** Check the terminal running `node proxy.js` for request/response details.
* **Open-WebUI Errors:** View logs with `docker logs open-webui`.
* **Port Conflict:** If 11434 is taken (e.g., by Ollama), stop it:

    ```bash
    killall ollama
    ```

* **API Key Issues:** Ensure `OPENROUTER_API_KEY` in `.env` is valid.

## Notes

* **Streaming:** Streaming responses from OpenRouter are aggregated into a single JSON object. True SSE streaming to the client isn’t implemented but can be added if needed.
* **Model Names:** `:latest` is appended to model IDs for Ollama compatibility and stripped before sending to OpenRouter.

## Contributing

Submit issues or pull requests on GitHub!

## License

MIT License - see [LICENSE](LICENSE) for details.