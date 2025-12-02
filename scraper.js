const axios = require('axios');
const cheerio = require('cheerio');

async function getDownloadLinks(videoId) {
  const url = `https://v6.www-y2mate.com/convert/`;
  const formData = new URLSearchParams();
  formData.append('videoId', videoId);

  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36',
    'Origin': 'https://v6.www-y2mate.com',
    'Referer': 'https://v6.www-y2mate.com/search/',
    'Cookie': 'SITE_TOTAL_ID=68d5d2aa3cc834e39022693b6ae690d0; _ga=GA1.1.1080028010.1764685520; _ga_ZWPL9SR6P6=GS2.1.s1764685519$o1$g1$t1764686508$j54$l0$h0'
  };

  try {
    const response = await axios.post(url, formData, { headers });
    const $ = cheerio.load(response.data);

    const iframeSrc = $('#widgetv2Api').attr('src');
    if (!iframeSrc) throw new Error("Iframe not found");

    const iframeUrl = iframeSrc.startsWith('http') ? iframeSrc : `https://frame.y2meta-uk.com/${iframeSrc.split('?')[1] ? iframeSrc : iframeSrc + '?videoId=' + videoId}`;
    
    const iframeRes = await axios.get(iframeUrl, { headers: { 'User-Agent': headers['User-Agent'] } });
    const \[ = cheerio.load(iframeRes.data);

    const title = \]('div.thumbnail.cover a').attr('title') || 'Unknown Title';
    const thumbnail = \[ ('div.thumbnail.cover img').attr('src') || '';
    const duration = \]('span.duration').text().trim() || 'Unknown';

    const downloads = [];

    \[ ('div.table tbody tr').each((i, el) => {
      const quality = \](el).find('td').eq(0).text().trim();
      const format = \[ (el).find('td').eq(1).text().trim().toLowerCase();
      const size = \](el).find('td').eq(2).text().trim();

      const btn = $$(el).find('button.btn-file');
      if (btn.length > 0) {
        const onclick = btn.attr('onclick');
        if (onclick && onclick.includes('get_link')) {
          const match = onclick.match(/get_link\('([^']+)','([^']+)','([^']+)'/);
          if (match) {
            const directLink = `https://load.y2meta-uk.com/download/get?videoId=\( {videoId}&k= \){match[3]}&t=${format}`;
            downloads.push({
              quality: quality.replace('p', 'p ').replace('kbps', 'kbps'),
              format: format,
              size: size,
              url: directLink
            });
          }
        }
      }
    });

    return {
      title,
      thumbnail: thumbnail.startsWith('http') ? thumbnail : 'https:' + thumbnail,
      duration,
      source: `https://www.youtube.com/watch?v=${videoId}`,
      downloads
    };

  } catch (err) {
    throw new Error("Failed to scrape: " + err.message);
  }
}

module.exports = { getDownloadLinks };
