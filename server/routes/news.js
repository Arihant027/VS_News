import { Router } from 'express';
import User from '../models/user.model.js';
import auth from '../middleware/auth.js';
import axios from 'axios';
import { GoogleGenerativeAI } from '@google/generative-ai';

const router = Router();

const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

const keywordMap = {
    'java': '(Java AND (programming OR software OR developer OR oracle OR Jakarta)) NOT island NOT coffee',
    '.net': '(".NET" OR "ASP.NET" OR C#) AND (microsoft OR software OR framework OR developer)',
    'data science': '"Data Science" OR "Machine Learning" OR "Artificial Intelligence" OR Pandas OR NumPy',
    'devops': 'DevOps OR CI/CD OR Jenkins OR Docker OR Kubernetes OR Terraform',
    'ci / cd pipelines': '"CI/CD" OR "Continuous Integration" OR "Continuous Deployment" OR Jenkins OR GitLab',
};

// GET /api/news - Fetch relevant news from GNews API
router.get('/', auth, async (req, res) => {
    try {
        const admin = await User.findById(req.user);
        if (!admin || !admin.categories || admin.categories.length === 0) {
            return res.json({ articles: [] });
        }
        const specificQueries = admin.categories.map(cat => keywordMap[cat.toLowerCase()] || `"${cat}"`);
        const query = specificQueries.join(' OR ');

        // Note: GNews free tier focuses on recent news (approx. last 24 hours) and does not support the 'from' date parameter.
        const gnewsApiResponse = await axios.get('https://gnews.io/api/v4/search', {
            params: {
                q: query,
                lang: 'en',
                country: 'us',
                max: 10,
                in: 'title,description',
                apikey: process.env.GNEWS_API_KEY,
            }
        });
        
        const transformedArticles = gnewsApiResponse.data.articles.map(article => ({
            source: { name: article.source.name },
            author: article.author,
            title: article.title,
            description: article.description,
            url: article.url,
            urlToImage: article.image,
            publishedAt: article.publishedAt,
            content: article.content,
        }));
        
        res.json({ articles: transformedArticles });
    } catch (err) {
        res.status(500).json({ message: 'Failed to fetch news from GNews API.', error: err.message });
    }
});

// POST /api/news/summarize - Summarize article text using Gemini
router.post('/summarize', auth, async (req, res) => {
    if (!genAI) {
        return res.status(500).json({ message: 'Gemini API client is not initialized. Please check your API key.' });
    }
    try {
        const { textToSummarize } = req.body;
        if (!textToSummarize) return res.status(400).json({ message: 'No text provided to summarize.' });

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
        
        // --- NEW, MORE DIRECT AND EFFECTIVE PROMPT ---
        const prompt = `
            Generate a professional, newsletter-style summary of the following news article.

            The summary must be:
            - Approximately 2-3 paragraphs long.
            - Engaging and informative for a professional audience.
            - It must capture the main topic, key findings, and important conclusions.
            - The tone should be objective and clear.
            - Do not start with conversational phrases.

            ARTICLE:
            """
            ${textToSummarize}
            """

            SUMMARY:
        `;
        
        const result = await model.generateContent(prompt);
        const summary = result.response.text();
        res.json({ summary });
    } catch (err) {
        res.status(500).json({ message: 'Failed to generate summary.', error: err.message });
    }
});

export default router;