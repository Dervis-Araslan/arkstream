// server.js
const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const app = express();
const port = 8080;

const streams = {};

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/start-stream', (req, res) => {
  const { username, password, ip, rtspPort, brand, streamName, channel} = req.query;

  // Gerekli parametre kontrolü
  if (!username || !password || !ip || !rtspPort || !brand || !streamName) {
    return res.status(400).json({ error: "Missing parameters." });
  }
  if (streams[streamName]) {
    return res.status(400).json({ error: "Stream name already in use." });
  }

  // RTSP URL oluştur
  let rtspUrl;
  if (brand.toLowerCase() === 'dahua') {
    rtspUrl = `rtsp://${username}:${password}@${ip}:${rtspPort}/cam/realmonitor?channel=${channel}&subtype=0`;
  } else if (brand.toLowerCase() === 'samsung') {
    rtspUrl = `rtsp://${username}:${password}@${ip}:${rtspPort}/profile1/media.smp`;
  } else {
    return res.status(400).json({ error: "Unsupported brand." });
  }

  // HLS çıktısı yolu
  const hlsPath = path.join(__dirname, 'public', `${streamName}.m3u8`);

  // FFmpeg argümanları
  const ffmpegArgs = [
  '-rtsp_transport','tcp',
  '-fflags','+genpts',
  '-use_wallclock_as_timestamps','1',
  '-i', rtspUrl,
  '-pix_fmt','yuv420p',
  '-c:v','libx264','-preset','ultrafast','-tune','zerolatency',
  '-b:v','800k','-r','30','-s','640x480',
  '-c:a','aac','-b:a','160k','-ar','44100',
  '-f','hls','-hls_time','1','-hls_list_size','5',
  '-hls_flags','delete_segments+append_list+omit_endlist',
  hlsPath
];

  console.log(`[${brand}] Starting FFmpeg: ${rtspUrl}`);

  // FFmpeg sürecini başlat
  const ffmpegProcess = spawn('ffmpeg', ffmpegArgs);

  ffmpegProcess.stderr.on('data', data => {
    console.error(`[FFmpeg ${streamName}] ${data.toString()}`);
  });

  ffmpegProcess.on('close', code => {
    console.log(`[FFmpeg ${streamName}] exited with code ${code}`);
    delete streams[streamName];
  });

  streams[streamName] = ffmpegProcess;
  res.json({ url: `http://localhost:${port}/${streamName}.m3u8` });
});

app.get('/stop-stream', (req, res) => {
  const { streamName } = req.query;

  if (!streamName || !streams[streamName]) {
    return res.status(400).json({ error: "Stream not found." });
  }

  // FFmpeg sürecini durdur
  streams[streamName].kill('SIGKILL');
  delete streams[streamName];

  res.json({ message: "Stream stopped." });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
