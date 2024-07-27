const express = require('express');
const cors = require('cors');
const ytdl = require('ytdl-core');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const app = express();
const port = 5000;

app.use(cors());

const formatDuration = (seconds) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hrs}h : ${mins}m : ${secs}s`;
};

const getFileSize = (size) => {
    if (!size) return 'Unknown';
    const i = Math.floor(Math.log(size) / Math.log(1024));
    return (size / Math.pow(1024, i)).toFixed(2) + ' ' + ['B', 'kB', 'MB', 'GB', 'TB'][i];
};

// Function to clean up temporary files
const cleanTempFiles = (filePaths) => {
    filePaths.forEach(filePath => {
        fs.unlink(filePath, (err) => {
            if (err) console.error(`Failed to delete ${filePath}:`, err);
        });
    });
};

app.get('/video-info', async (req, res) => {
    const videoUrl = req.query.url;
    try {
        const info = await ytdl.getInfo(videoUrl);
        const formats = ytdl.filterFormats(info.formats, 'audioandvideo');
        const videoDetails = info.videoDetails;
        const duration = formatDuration(videoDetails.lengthSeconds);

        // Additional formats to include
        const additionalFormats = [
            { qualityLabel: '144p', itag: '160', container: 'mp4' },
            { qualityLabel: '240p', itag: '133', container: 'mp4' },
            { qualityLabel: '360p', itag: '134', container: 'mp4' },
            { qualityLabel: '480p', itag: '135', container: 'mp4' },
            { qualityLabel: '720p', itag: '136', container: 'mp4' },
            { qualityLabel: '1080p', itag: '137', container: 'mp4' }
        ];

        // Combine available formats with additional formats
        const combinedFormats = [
            ...formats.filter(format => format.container === 'mp4' && format.qualityLabel.match(/^(144p|240p|360p|480p|720p|1080p)$/)),
            ...additionalFormats
        ];

        // Remove duplicates
        const uniqueFormats = [...new Map(combinedFormats.map(format => [format.qualityLabel, format])).values()];

        // Fetch file size for each format
        const formatsWithSize = await Promise.all(uniqueFormats.map(async (format) => {
            const sizeInfo = await ytdl.getInfo(videoUrl, { format: format.itag });
            const size = sizeInfo.formats.find(f => f.itag === format.itag)?.contentLength;
            return {
                ...format,
                size: getFileSize(size)
            };
        }));

        res.json({ videoDetails, formats: formatsWithSize, duration });
    } catch (error) {
        console.error('Error fetching video info:', error);
        res.status(500).send('Failed to fetch video info.');
    }
});

app.get('/download', async (req, res) => {
    const videoUrl = req.query.url;
    const format = req.query.format;

    try {
        const info = await ytdl.getInfo(videoUrl);
        const availableFormats = ytdl.filterFormats(info.formats, 'audioandvideo');

        // Find the specific format requested
        let videoFormat = availableFormats.find(f => f.qualityLabel === format && f.container === 'mp4');

        // If the requested format is not found, fallback to the best available quality
        if (!videoFormat) {
            videoFormat = ytdl.chooseFormat(info.formats, { quality: 'highestvideo' });
        }

        // Choose audio format
        const audioFormat = ytdl.chooseFormat(info.formats, { quality: 'highestaudio' });

        // Download video and audio streams
        const videoStream = ytdl(videoUrl, { format: videoFormat.itag });
        const audioStream = ytdl(videoUrl, { format: audioFormat.itag });

        const tempVideoPath = path.join(__dirname, 'temp_video.mp4');
        const tempAudioPath = path.join(__dirname, 'temp_audio.mp4');
        const outputFilePath = path.join(__dirname, `output_${format}.mp4`);

        // Download video
        videoStream.pipe(fs.createWriteStream(tempVideoPath)).on('finish', () => {
            // Download audio
            audioStream.pipe(fs.createWriteStream(tempAudioPath)).on('finish', () => {
                // Merge video and audio using ffmpeg with scaling filter
                ffmpeg()
                    .input(tempVideoPath)
                    .input(tempAudioPath)
                    .outputOptions('-vf', `scale=-1:${format.split('p')[0]}`, '-c:a', 'copy')
                    .output(outputFilePath)
                    .on('end', () => {
                        // Provide the downloadable file to the client
                        res.download(outputFilePath, 'video.mp4', (err) => {
                            if (err) {
                                console.error('Download error:', err);
                                res.status(500).send('Failed to download the video.');
                            }
                            // Clean up temporary files after download
                            cleanTempFiles([tempVideoPath, tempAudioPath, outputFilePath]);
                        });
                    })
                    .on('error', (error) => {
                        console.error('Error merging video and audio:', error);
                        res.status(500).send('Failed to merge video and audio.');
                    })
                    .run();
            }).on('error', (error) => {
                console.error('Error downloading audio:', error);
                res.status(500).send('Failed to download audio.');
            });
        }).on('error', (error) => {
            console.error('Error downloading video:', error);
            res.status(500).send('Failed to download video.');
        });
    } catch (error) {
        console.error('Error fetching video info:', error);
        res.status(500).send('Failed to fetch video info.');
    }
});

app.listen(port, () => console.log(`Server running on http://localhost:${port}`));
