const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Function to parse HTML and extract video information
function parseVideoInfo(html) {
    try {
        const $ = cheerio.load(html);
        
        // Extract video title
        const title = $('.videoTitle').attr('title') || $('.videoTitle').text() || 'Unknown Video';
        
        // Extract thumbnail
        const thumbnail = $('.thumbnail').attr('src') || '';
        
        // Extract duration
        const durationText = $('.duration').text() || '';
        const durationMatch = durationText.match(/(\d+):(\d+):(\d+)/) || durationText.match(/(\d+):(\d+)/);
        let duration = 0;
        
        if (durationMatch) {
            if (durationMatch[3]) {
                // HH:MM:SS format
                duration = parseInt(durationMatch[1]) * 3600 + parseInt(durationMatch[2]) * 60 + parseInt(durationMatch[3]);
            } else {
                // MM:SS format
                duration = parseInt(durationMatch[1]) * 60 + parseInt(durationMatch[2]);
            }
        }
        
        // Parse all download links from the table
        const videoFormats = [];
        const audioFormats = [];
        
        // Find all table rows
        $('.list tbody tr').each((index, row) => {
            const $row = $(row);
            const cells = $row.find('td');
            
            if (cells.length >= 3) {
                // First cell: Quality/Format info
                const qualityCell = $(cells[0]);
                const qualityText = qualityCell.text().trim();
                
                // Extract quality and format
                let quality = '';
                let format = '';
                let type = 'video';
                
                // Check if it's audio
                if (qualityText.includes('M4A') || qualityText.includes('AAC')) {
                    type = 'audio';
                    format = 'M4A';
                    quality = qualityText.match(/\d+kbps/i) ? qualityText.match(/\d+kbps/i)[0] : '128kbps';
                } else {
                    // Video quality
                    const qualityMatch = qualityText.match(/(\d+p)/i);
                    quality = qualityMatch ? qualityMatch[1] : qualityText;
                    format = 'MP4';
                }
                
                // Second cell: File size
                const sizeText = $(cells[1]).text().trim();
                let size = 0;
                
                // Convert size string to bytes
                if (sizeText) {
                    const sizeMatch = sizeText.match(/(\d+\.?\d*)\s*(MB|GB|KB)/i);
                    if (sizeMatch) {
                        const num = parseFloat(sizeMatch[1]);
                        const unit = sizeMatch[2].toUpperCase();
                        
                        if (unit === 'GB') size = num * 1024 * 1024 * 1024;
                        else if (unit === 'MB') size = num * 1024 * 1024;
                        else if (unit === 'KB') size = num * 1024;
                    }
                }
                
                // Third cell: Download button
                const downloadButton = $(cells[2]).find('button');
                const downloadUrl = downloadButton.attr('data-url') || '';
                
                if (downloadUrl) {
                    const formatInfo = {
                        quality: quality,
                        format: format,
                        size: Math.round(size),
                        type: type,
                        download_url: downloadUrl
                    };
                    
                    // Add extra info if available
                    const hasAudio = downloadButton.attr('data-has-audio');
                    if (hasAudio !== undefined) {
                        formatInfo.has_audio = hasAudio === 'true';
                    }
                    
                    const dataQuality = downloadButton.attr('data-quality');
                    if (dataQuality) {
                        formatInfo.quality = dataQuality;
                    }
                    
                    const dataSize = downloadButton.attr('data-size');
                    if (dataSize) {
                        formatInfo.size = parseInt(dataSize);
                    }
                    
                    if (type === 'video') {
                        videoFormats.push(formatInfo);
                    } else {
                        audioFormats.push(formatInfo);
                    }
                }
            }
        });
        
        // Sort video formats by quality
        const qualityOrder = ['144p', '240p', '360p', '480p', '720p', '1080p', '1440p', '2160p'];
        videoFormats.sort((a, b) => {
            const aIndex = qualityOrder.indexOf(a.quality);
            const bIndex = qualityOrder.indexOf(b.quality);
            return aIndex - bIndex;
        });
        
        // Sort audio formats by bitrate
        audioFormats.sort((a, b) => {
            const getBitrate = (q) => parseInt(q) || 0;
            return getBitrate(b.quality) - getBitrate(a.quality);
        });
        
        return {
            title: title.trim(),
            thumbnail: thumbnail,
            duration: duration,
            video_formats: videoFormats,
            audio_formats: audioFormats
        };
    } catch (error) {
        console.error('Error parsing HTML:', error);
        return null;
    }
}

// Main endpoint
app.get('/', async (req, res) => {
    try {
        const youtubeUrl = req.query.url;
        
        if (!youtubeUrl) {
            return res.status(400).json({
                status: 0,
                message: 'Please provide YouTube URL in query parameter',
                example: 'https://youtubedownloaderxv.onrender.com/?url=https://youtu.be/VIDEO_ID'
            });
        }

        // Validate YouTube URL
        const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.?be)\/.+$/;
        if (!youtubeRegex.test(youtubeUrl)) {
            return res.status(400).json({
                status: 0,
                message: 'Invalid YouTube URL'
            });
        }

        // Headers from your request
        const headers = {
            'authority': 'ssyoutube.online',
            'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
            'accept-language': 'en-US,en;q=0.9',
            'cache-control': 'max-age=0',
            'content-type': 'application/x-www-form-urlencoded',
            'origin': 'https://ssyoutube.online',
            'referer': 'https://ssyoutube.online/en2/',
            'sec-ch-ua': '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
            'sec-ch-ua-mobile': '?1',
            'sec-ch-ua-platform': '"Android"',
            'sec-fetch-dest': 'document',
            'sec-fetch-mode': 'navigate',
            'sec-fetch-site': 'same-origin',
            'upgrade-insecure-requests': '1',
            'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36',
            'cookie': 'pll_language=en; _ga=GA1.1.1194969633.1764704624; _ga_2DJ6MW2B9R=GS2.1.s1764704623$o1$g1$t1764704646$j37$l0$h0'
        };

        // Request body
        const body = new URLSearchParams();
        body.append('videoURL', youtubeUrl);

        // Make POST request to ssyoutube
        const response = await axios.post('https://ssyoutube.online/yt-video-detail/', body, {
            headers: headers,
            timeout: 30000
        });

        // Parse the HTML response
        const videoInfo = parseVideoInfo(response.data);
        
        if (!videoInfo || (videoInfo.video_formats.length === 0 && videoInfo.audio_formats.length === 0)) {
            return res.status(404).json({
                status: 0,
                message: 'No download links found. The video might be restricted or unavailable.'
            });
        }

        res.json({
            status: 1,
            ...videoInfo
        });

    } catch (error) {
        console.error('Error:', error.message);
        
        // Check if it's a specific error
        if (error.response) {
            if (error.response.status === 404) {
                return res.status(404).json({
                    status: 0,
                    message: 'Video not found or URL is invalid'
                });
            }
        }
        
        res.status(500).json({
            status: 0,
            message: 'Failed to fetch video information',
            error: error.message
        });
    }
});

// Alternative direct download endpoint
app.get('/api/download', async (req, res) => {
    try {
        const youtubeUrl = req.query.url;
        const quality = req.query.quality || '720p';
        
        if (!youtubeUrl) {
            return res.status(400).json({
                status: 0,
                message: 'YouTube URL is required'
            });
        }

        // First get all formats
        const allFormats = await axios.get(`http://localhost:${PORT}/?url=${encodeURIComponent(youtubeUrl)}`, {
            timeout: 10000
        });
        
        if (allFormats.data.status !== 1) {
            throw new Error(allFormats.data.message || 'Failed to get video info');
        }
        
        // Find the requested quality
        let downloadUrl = null;
        let formatInfo = null;
        
        // Check video formats
        if (allFormats.data.video_formats) {
            formatInfo = allFormats.data.video_formats.find(f => 
                f.quality.toLowerCase() === quality.toLowerCase()
            );
        }
        
        // If not found in video, check audio
        if (!formatInfo && allFormats.data.audio_formats) {
            formatInfo = allFormats.data.audio_formats.find(f => 
                f.quality.toLowerCase() === quality.toLowerCase()
            );
        }
        
        if (!formatInfo) {
            // Return available qualities
            return res.status(404).json({
                status: 0,
                message: `Quality ${quality} not available`,
                available_video_qualities: allFormats.data.video_formats.map(f => f.quality),
                available_audio_qualities: allFormats.data.audio_formats.map(f => f.quality)
            });
        }
        
        res.json({
            status: 1,
            title: allFormats.data.title,
            quality: formatInfo.quality,
            format: formatInfo.format,
            size: formatInfo.size,
            download_url: formatInfo.download_url
        });

    } catch (error) {
        console.error('Download error:', error);
        res.status(500).json({
            status: 0,
            message: 'Failed to get download link'
        });
    }
});

// Simple endpoint for testing
app.get('/test', async (req, res) => {
    try {
        // Test with a sample YouTube URL
        const testUrl = 'https://youtu.be/DcFUsUR107U';
        
        const response = await axios.get(`http://localhost:${PORT}/?url=${encodeURIComponent(testUrl)}`, {
            timeout: 10000
        });
        
        res.json({
            status: 'Test completed',
            data: response.data
        });
        
    } catch (error) {
        res.json({
            status: 'Test failed',
            error: error.message
        });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        service: 'YouTube Downloader API (ssyoutube.online)',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        endpoints: {
            main: '/?url=YOUTUBE_URL',
            direct: '/api/download?url=YOUTUBE_URL&quality=720p',
            health: '/health',
            test: '/test'
        }
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📺 YouTube Downloader API (ssyoutube.online scraper)`);
    console.log(`🔗 Main endpoint: http://localhost:${PORT}/?url=YOUTUBE_URL`);
    console.log(`⬇️  Direct download: http://localhost:${PORT}/api/download?url=YOUTUBE_URL&quality=720p`);
    console.log(`🧪 Test: http://localhost:${PORT}/test`);
});