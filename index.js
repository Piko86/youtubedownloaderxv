const express = require('express');
const { getDownloadLinks } = require('./scraper');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static('public')); // optional frontend

app.get('/api', async (req, res) => {
  const { url } = req.query;

  if (!url || !url.includes('youtube.com') && !url.includes('youtu.be')) {
    return res.status(400).json({ error: "Please provide a valid YouTube URL" });
  }

  let videoId = '';
  try {
    if (url.includes('youtu.be')) {
      videoId = url.split('youtu.be/')[1].split('?')[0];
    } else {
      videoId = new URLSearchParams(url.split('?')[1]).get('v') || url.match(/v=([^&]+)/)?.[1];
    }

    if (!videoId) throw new Error("Invalid YouTube URL");

    const result = await getDownloadLinks(videoId);
    res.json(result);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => {
  res.send(`
    <h1>Y2Mate API Running</h1>
    <p>Use: <code>https://youtubedownloaderxv.onrender.com/api?url=https://youtube.com/watch?v=0KHAE7M15D0</code></p>
  `);
});

app.listen(PORT, () => {
  console.log(`API running on port ${PORT}`);
});
