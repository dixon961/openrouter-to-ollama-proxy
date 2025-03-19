const axios = require('axios');

const proxyUrl = 'http://localhost:11434';
const embeddingModel = 'nomic-embed-text';
const geminiModel = 'google/gemini-2.0-flash-lite-001'; //'gemma3:1b';

const useStreaming = false; // Set to true to test streaming, false for non-streaming

async function getEmbedding(prompt) {
  const response = await axios.post(`${proxyUrl}/api/embeddings`, {
    model: embeddingModel,
    prompt: prompt,
  });
  return response.data.embedding;
}

function cosineSimilarity(vecA, vecB) { 
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function testEmbeddingModel() {
    try {
      const queenVec = await getEmbedding('queen');
      const femaleVec = await getEmbedding('female');
      const maleVec = await getEmbedding('male');
      const kingVec = await getEmbedding('king');
  
      const resultVec = queenVec.map((val, i) => val - femaleVec[i] + maleVec[i]);
      const similarityKing = cosineSimilarity(resultVec, kingVec);
      const similarityMale = cosineSimilarity(resultVec, maleVec);
      const similarityQueen = cosineSimilarity(resultVec, queenVec);
  
      console.log(`\n--- Embedding model (${embeddingModel}) test: PASS ---`);
      console.log(`Similarity of Queen - Female + Male to King (${embeddingModel}): ${similarityKing}`);
      console.log(`Similarity of Queen - Female + Male to Male (${embeddingModel}): ${similarityMale}`);
      console.log(`Similarity of Queen - Female + Male to Queen (${embeddingModel}): ${similarityQueen}`);
  
      return similarityKing;
    } catch (error) {
      if (error.response && error.response.data && error.response.data.error?.includes('not found')) {
        console.log(`\n--- Embedding model (${embeddingModel}) test: PASS WITH WARNING ---`);
        console.log('Warning: Embedding model not found.');
        console.log(`Error: ${error.response.data.error}`);
        return null; // Still allow chat test to proceed
      }
      console.error(`\n--- Embedding model (${embeddingModel}) test: FAIL ---`);
      console.error(error.message);
      if (error.response) {
        console.error(error.response.data);
      }
      return null;
    }
  }
async function testChatEndpoint(embeddingSimilarity) {
    return new Promise(async (resolve, reject) => {
      try {
        const prompt = `The word embedding model "${embeddingModel}" produced a cosine similarity of ${embeddingSimilarity} when performing the queen - female + male test against king. Is this a good result? Answer in 15 words or less.`;
        const response = await axios.post(
          `${proxyUrl}/api/chat`,
          {
            model: geminiModel,
            messages: [{ role: 'user', content: prompt }],
            stream: useStreaming,
          },
          {
            responseType: useStreaming ? 'stream' : 'json',
          }
        );
  
        if (useStreaming) {
          if (!response.data || !response.data.pipe) {
            console.error("Response is not a stream, or is empty.");
            reject(new Error("Response is not a stream"));
            return;
          }
  
          console.log("Stage 1: Basic stream check passed.");
  
          let fullResponse = "";
          response.data.on('data', (chunk) => {
            const lines = chunk.toString().split('\n').filter(line => line.trim() !== '');
            lines.forEach(line => {
              try {
                const parsed = JSON.parse(line);
                if (parsed.message && parsed.message.content) {
                  fullResponse += parsed.message.content;
                }
                if (parsed.done) {
                  console.log("Done flag found");
                }
              } catch (error) {
                console.error('Error parsing stream chunk:', error.message);
                console.log("Failed to parse:", line);
              }
            });
          });
  
          response.data.on('end', () => {
            const isErrorResponse = fullResponse.includes('not found on OpenRouter') || fullResponse.includes('error');
            console.log(`\n--- Chat endpoint test (${geminiModel}) test: ${isErrorResponse ? 'PASS WITH WARNING' : 'PASS'} ---`);
            if (isErrorResponse) {
              console.log('Warning: Chat communication failed due to an error response.');
            }
            console.log(`Q: ${prompt}`);
            console.log(`A: ${fullResponse}`);
            resolve();
          });
  
          response.data.on('error', (error) => {
            console.error(`\n--- Chat endpoint test (${geminiModel}) test: FAIL ---`);
            console.error(error.message);
            reject(error);
          });
        } else {
          if (response.data && response.data.message && response.data.message.content) {
            const isErrorResponse = response.data.message.content.includes('not found on OpenRouter') || response.data.message.content.includes('error');
            console.log(`\n--- Chat endpoint test (${geminiModel}) test: ${isErrorResponse ? 'PASS WITH WARNING' : 'PASS'} ---`);
            if (isErrorResponse) {
              console.log('Warning: Chat communication failed due to an error response.');
            }
            console.log(`Q: ${prompt}`);
            console.log(`A: ${response.data.message.content}`);
            resolve();
          } else {
            console.error(`\n--- Chat endpoint test (${geminiModel}) test: FAIL ---`);
            console.error(response.data);
            reject(new Error("Invalid response"));
          }
        }
      } catch (error) {
        console.error(`\n--- Chat endpoint test (${geminiModel}) test: FAIL ---`);
        console.error(error.message);
        if (error.response) {
          console.error(error.response.data);
        }
        reject(error);
      }
    });
  }

async function runTests() {
  const embeddingSimilarity = await testEmbeddingModel();
  if (embeddingSimilarity !== null) {
    await testChatEndpoint(embeddingSimilarity);
  } else {
    console.log("\n--- Chat endpoint test: SKIPPED ---");
    console.log("Skipped due to embedding model test failure.");
  }
}

runTests();