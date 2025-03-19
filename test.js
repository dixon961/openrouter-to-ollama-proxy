const axios = require('axios');

const proxyUrl = 'http://localhost:11434';
const embeddingModel = 'nomic-emb1ed-text';
const geminiModel = 'google/gemini-2.0-flash-lite-001';

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
    console.error(`\n--- Embedding model (${embeddingModel}) test: FAIL ---`);
    console.error(error.message);
    if (error.response) {
      console.error(error.response.data);
    }
    return null;
  }
}

async function testOpenRouterProxyAssessment(embeddingSimilarity) {
  try {
    const prompt = `The word embedding model "${embeddingModel}" produced a cosine similarity of ${embeddingSimilarity} when performing the queen - female + male test against king. Is this a good result? Answer in 15 words or less.`;
    const response = await axios.post(`${proxyUrl}/api/chat`, {
      model: geminiModel,
      messages: [{ role: 'user', content: prompt }],
    });

    if (response.status === 200 && response.data && response.data.message && response.data.message.content) {
      console.log(`\n--- OpenRouter proxy assessment test (${geminiModel}) test: PASS ---`);
      console.log(`Q: ${prompt}`);
      console.log(`A: ${response.data.message.content}`);
    } else {
      console.error(`\n--- OpenRouter proxy assessment test (${geminiModel}) test: FAIL ---`);
      console.error(response.data);
    }
  } catch (error) {
    console.error(`\n--- OpenRouter proxy assessment test (${geminiModel}) test: FAIL ---`);
    console.error(error.message);
    if (error.response) {
      console.error(error.response.data);
    }
  }
}

async function runTests() {
  const embeddingSimilarity = await testEmbeddingModel();
  if (embeddingSimilarity !== null) {
    await testOpenRouterProxyAssessment(embeddingSimilarity);
  } else {
    console.log("\n--- OpenRouter proxy assessment test: SKIPPED ---");
    console.log("Skipped due to embedding model test failure.");
  }
}

runTests();