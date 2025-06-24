import { Router } from 'express';
import puppeteer from 'puppeteer';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { format } from 'date-fns';
import sgMail from '@sendgrid/mail';
import Newsletter from '../models/newsletter.model.js';
import User from '../models/user.model.js';
import auth from '../middleware/auth.js';
import Notification from '../models/notification.model.js';

const router = Router();

// --- START: INITIALIZE SENDGRID ---
if (process.env.SENDGRID_API_KEY) {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    console.log("✅ SendGrid client initialized.");
} else {
    console.warn("⚠️ SendGrid API Key not found. Email sending will be disabled.");
}
// --- END: INITIALIZE SENDGRID ---

// Initialize the Gemini AI Client
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

// Helper function to create the AI prompt
const createHtmlGenerationPrompt = (articles, title) => {
    const articlesForPrompt = articles.map(a => ({
        title: a.title,
        summary: a.summary,
        source: a.sourceName,
        category: a.category,
        originalUrl: a.originalUrl
    }));

    return `
        Act as an expert newsletter designer. Generate a single, complete, beautifully designed HTML file for a professional tech newsletter.
        **Instructions:**
        1.  All CSS must be in a <style> tag. Use a modern, clean design with a primary color of #2563eb.
        2.  Use a professional, readable, sans-serif font like 'Inter' or 'Lato' from Google Fonts.
        3.  The main header should be "${title}". Include today's date: ${format(new Date(), 'PP')}.
        4.  For each article, create a distinct section. The article's 'title' MUST be a clickable hyperlink pointing to its 'originalUrl'. Also, display the article's 'source' and 'summary'.
        **JSON Data:**
        \`\`\`json
        ${JSON.stringify(articlesForPrompt, null, 2)}
        \`\`\`
        **Your Response MUST be only the raw HTML code, starting with <!DOCTYPE html>.**
    `;
};


// GET all newsletters for the logged-in admin's categories
router.get('/', auth, async (req, res) => {
  try {
    const admin = await User.findById(req.user);
    if (!admin || !admin.categories || admin.categories.length === 0) {
        return res.json([]);
    }
    const newsletters = await Newsletter.find({ category: { $in: admin.categories } });
    res.json(newsletters);
  } catch (err) {
    res.status(500).json({ message: 'Server error fetching newsletters.' });
  }
});

// --- START: NEW ENDPOINT TO GENERATE, SAVE, AND SEND PDF ---
router.post('/generate-and-save', auth, async (req, res) => {
    if (!genAI) {
        return res.status(500).json({ message: 'Gemini API client is not initialized.' });
    }
    
    try {
        const { articles, title, category } = req.body;
        console.log(`[PDF LOG] Received request to generate newsletter titled: "${title}"`);

        if (!articles || articles.length === 0 || !title || !category) {
            console.error("[PDF ERROR] Missing title, category, or articles in request body.");
            return res.status(400).json({ message: 'Title, category, and articles are required.' });
        }

        // 1. Generate HTML with AI
        console.log("[PDF LOG] Generating HTML prompt for AI...");
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
        const prompt = createHtmlGenerationPrompt(articles, title);
        
        console.log("[PDF LOG] Sending prompt to AI...");
        const result = await model.generateContent(prompt);
        let generatedHtml = result.response.text().replace(/^```html\n/, '').replace(/\n```$/, '');

        if (!generatedHtml || generatedHtml.length < 100) {
            console.error("[PDF ERROR] AI returned an empty or invalid HTML response.");
            throw new Error('AI returned an empty or invalid response.');
        }
        console.log("[PDF LOG] Successfully received HTML from AI. Starting PDF conversion...");

        // 2. Convert HTML to PDF
        const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
        const page = await browser.newPage();
        await page.setContent(generatedHtml, { waitUntil: 'networkidle0' });
        const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
        await browser.close();
        console.log("[PDF LOG] Successfully converted HTML to PDF buffer.");

        // 3. Create and Save New Newsletter to DB
        console.log("[PDF LOG] Saving new newsletter to database...");
        const newNewsletter = new Newsletter({
            title,
            category,
            articles: articles.map(a => a._id),
            // MODIFIED: Changed 'draft' to 'Not Sent'
            status: 'Not Sent',
            pdfContent: {
                data: Buffer.from(pdfBuffer),
                contentType: 'application/pdf'
            }
        });
        await newNewsletter.save();
        console.log(`[PDF LOG] Successfully saved newsletter with ID: ${newNewsletter._id}`);
        
        // 4. Send the generated PDF back to the client
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${title.replace(/\s/g, '_')}.pdf"`);
        res.send(pdfBuffer);

    } catch (err) {
        console.error("--- PDF GENERATION/SAVE FAILED ---");
        console.error(err);
        console.error("------------------------------------");
        res.status(500).json({ message: 'Failed to generate and save PDF. Check server logs for details.' });
    }
});

// --- START: NEW ENDPOINT TO DOWNLOAD A SAVED PDF ---
router.get('/:id/download', auth, async (req, res) => {
    try {
        const newsletter = await Newsletter.findById(req.params.id);

        if (!newsletter || !newsletter.pdfContent || !newsletter.pdfContent.data) {
            return res.status(404).send('PDF not found.');
        }

        res.setHeader('Content-Type', newsletter.pdfContent.contentType);
        res.setHeader('Content-Disposition', `inline; filename="${newsletter.title.replace(/\s/g, '_')}.pdf"`);
        res.send(newsletter.pdfContent.data);

    } catch (err) {
        res.status(500).send('Server error while retrieving PDF.');
    }
});

// PATCH - Update a newsletter's status
router.patch('/:id/status', auth, async (req, res) => {
  try {
    const { status } = req.body;
    const updatedNewsletter = await Newsletter.findByIdAndUpdate(
        req.params.id, 
        { status },
        { new: true }
    );
    res.json(updatedNewsletter);
  } catch (err) {
    res.status(500).json({ message: 'Server error updating status.' });
  }
});

// --- START: NEW ENDPOINT TO DELETE A NEWSLETTER ---
router.delete('/:id', auth, async (req, res) => {
  try {
    const newsletter = await Newsletter.findByIdAndDelete(req.params.id);

    if (!newsletter) {
      return res.status(404).json({ message: 'Newsletter not found.' });
    }

    res.json({ message: 'Newsletter deleted successfully.' });

  } catch (err) {
    console.error("Newsletter Deletion Error:", err);
    res.status(500).json({ message: 'Server error while deleting newsletter.' });
  }
});
// --- END: NEW ENDPOINT ---

// --- FINAL AND CORRECT "SEND" ROUTE ---
router.post('/:id/send', auth, async (req, res) => {
    try {
        const { userIds } = req.body;

        if (!userIds || userIds.length === 0) {
            return res.status(400).json({ message: 'No recipients selected.' });
        }

        const newsletter = await Newsletter.findById(req.params.id);
        if (!newsletter) {
            return res.status(404).json({ message: 'Newsletter not found.' });
        }
        
        // --- Email Sending Logic ---
        if (process.env.SENDGRID_API_KEY) {
            const recipients = await User.find({ '_id': { $in: userIds } }).select('email');
            if (recipients.length > 0) {
                 const msg = {
                    to: recipients.map(r => r.email),
                    from: { name: 'NewsLetterAI', email: process.env.FROM_EMAIL },
                    subject: `Your Newsletter: ${newsletter.title}`,
                    html: `<p>A new newsletter, <strong>${newsletter.title}</strong>, is now available. Please find it attached.</p>`,
                    attachments: [{
                        content: newsletter.pdfContent.data.toString('base64'),
                        filename: `${newsletter.title.replace(/\s/g, '_')}.pdf`,
                        type: 'application/pdf',
                        disposition: 'attachment',
                    }],
                };
                await sgMail.send(msg);
            }
        }

        // --- Database Update Logic ---
        newsletter.status = 'sent';
        newsletter.recipients.addToSet(...userIds);
        await newsletter.save();
        
        // --- Reinforced Notification Logic ---
        try {
            console.log(`Attempting to create ${userIds.length} notifications.`);
            const notifications = userIds.map(userId => ({
                user: userId,
                newsletter: newsletter._id,
                message: `You received the "${newsletter.title}" newsletter.`,
            }));

            if (notifications.length > 0) {
                await Notification.insertMany(notifications, { ordered: false });
                console.log('Successfully inserted notifications.');
            }
        } catch (notificationError) {
            // If ONLY notification creation fails, log it but don't fail the whole request
            console.error('CRITICAL: Failed to create notifications, but email was sent.', notificationError);
        }

        res.json({ message: `Newsletter successfully sent to ${userIds.length} user(s).` });

    } catch (err) {
        console.error('A major error occurred in the /send route:', err);
        res.status(500).json({ message: 'Failed to send newsletter due to a server error.' });
    }
});


export default router;