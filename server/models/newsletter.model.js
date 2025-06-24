import mongoose from 'mongoose';
const { Schema } = mongoose;

const newsletterSchema = new Schema({
  title: { type: String, required: true },
  category: { type: String, required: true },
  status: { 
    type: String, 
    enum: ['draft', 'pending', 'approved', 'sent', 'declined'], 
    default: 'draft' 
  },
  articles: [{ type: Schema.Types.ObjectId, ref: 'CuratedArticle' }],
  // --- ADD THE FIELD BELOW ---
  recipients: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  pdfContent: {
    data: Buffer,
    contentType: String
  }
}, {
  timestamps: true,
});

const Newsletter = mongoose.model('Newsletter', newsletterSchema);
export default Newsletter;