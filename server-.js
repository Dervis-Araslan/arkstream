const express = require('express');
const { exec } = require('child_process');
const path = require('path');
const app = express();
const port = 8080;

const streams = {};

app.use(express.json());

// Statik dosyaları servis et
app.use(express.static(path.join(__dirname, 'public')));

app.get('/start-stream', (req, res) => {
  const { username, password, ip, rtspPort, streamName } = req.query;

  if (!username || !password || !ip || !rtspPort || !streamName) {
    return res.status(400).json({ error: "Missing parameters." });
  }

  const rtspUrl = `rtsp://${username}:${password}@${ip}:${rtspPort}/profile1/media.smp`;
  const hlsPath = path.join(__dirname, 'public', `${streamName}.m3u8`);

  if (streams[streamName]) {
    return res.status(400).json({ error: "Stream name already in use." });const http = require('http');
const { exec } = require('child_process');
const url = require('url');

// Sunucu ayarları
const hostname = '0.0.0.0';
const port = 3000;

// Yayın URL'si ve FFmpeg komutu
const streamUrl = 'http://example.com/stream';
const ffmpegCommand = `ffmpeg -i ${streamUrl} -c:v libx264 -f flv rtmp://localhost/live/stream`; // Örnek FFmpeg komutu

// HTTP Sunucu oluşturma
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  if (parsedUrl.pathname === '/start-stream') {
    // FFmpeg komutunu çalıştırma
    exec(ffmpegCommand, (error, stdout, stderr) => {
      if (error) {
        console.error(`Hata: ${error.message}`);
        res.statusCode = 500;
        res.setHeader('Content-Type', 'text/plain');
        res.end(`Yayın başlatılamadı: ${error.message}`);
        return;
      }
      if (stderr) {
        console.error(`FFmpeg Hata Çıkışı: ${stderr}`);
      }
      console.log(`FFmpeg Çıkışı: ${stdout}`);
    });

    // FFmpeg komutunu ekrana yazdırma
    console.log(`FFmpeg Komutu: ${ffmpegCommand}`);

    // İstemciye yanıt gönderme
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain');
    res.end(`Yayın başlatıldı: ${streamUrl}\nFFmpeg Komutu: ${ffmpegCommand}`);
  } else {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain');
    res.end('Sayfa bulunamadı');
  }
});

// Sunucuyu dinlemeye başlama
server.listen(port, hostname, () => {
  console.log(`Sunucu http://${hostname}:${port}/start-stream adresinde çalışıyor`);
});

  }

  const ffmpegCommand = `ffmpeg -rtsp_transport tcp -i ${rtspUrl} -c:v libx264 -preset ultrafast -tune zerolatency -b:v 800k -r 30 -s 640x480 -c:a aac -b:a 160k -ar 44100 -f hls -hls_time 1 -hls_list_size 5 -hls_flags delete_segments+append_list+omit_endlist ${hlsPath}`;

  const ffmpegProcess = exec(ffmpegCommand, (error, stdout, stderr) => {
    if (error) {
      console.error(`Error: ${error.message}`);
      delete streams[streamName];
      return res.status(500).json({ error: error.message });
    }
    if (stderr) {
      console.error(`FFmpeg stderr: ${stderr}`);
    }
    console.log(`FFmpeg stdout: ${stdout}`);
  });

  streams[streamName] = ffmpegProcess;
  res.json({ url: `http://localhost:${port}/${streamName}.m3u8` });
});

app.get('/stop-stream', (req, res) => {
  const { streamName } = req.query;

  if (!streamName) {
    return res.status(400).json({ error: "Missing parameters." });
  }

  if (!streams[streamName]) {
    return res.status(400).json({ error: "Stream not found." });
  }

  streams[streamName].kill('SIGINT');
  delete streams[streamName];
  res.json({ message: "Stream stopped." });
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
