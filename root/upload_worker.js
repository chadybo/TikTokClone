const Queue = require('bull');
const { exec } = require('child_process');
const fs = require('fs');
const mongoose = require('mongoose');

// Connect to MongoDB
const dbURI = 'mongodb://admin:tryanDHac23435356UsN0WUca34ntdoitANymOreBcUZ2349874456472POlk89@0.0.0.0:27017/your_database_server?authSource=admin';
const options = {  
  useNewUrlParser: true,
  useUnifiedTopology: true,
};

mongoose.connect(dbURI, options)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// Define the Video model (if it's not in a separate file)
const videoSchema = new mongoose.Schema({
  id: String,
  title: String,
  description: String,
  author: String,
  processing: Boolean,
});

const Video = mongoose.model('Video', videoSchema);

// Connect to the shared Redis queue
const videoQueue = new Queue('video-processing', {
  redis: { host: '127.0.0.1', port: 6379 },
});

// Process jobs in the queue
videoQueue.process(1, async (job) => { // Limit concurrency to 1
  const { videoId, filePath, permanentFileName } = job.data;

  try {
    const permanentPath = `/root/videos/${permanentFileName}`;

    // Move the uploaded file to the permanent location
    await new Promise((resolve, reject) => {
      fs.rename(filePath, permanentPath, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    // console.log(`Processing video: ${videoId}`);

    // Execute the chunking script //COMMENT THIS OUT FOR MILESTONE3 CHEESE
    const chunkCommand = `/root/videos/chunk_one_vid.sh "${permanentPath}" "${videoId}"`;
    await new Promise((resolve, reject) => {
      exec(chunkCommand, { cwd: '/root/videos' }, (error, stdout, stderr) => {
        if (error) return reject(stderr);
        resolve(stdout);
      });
    });

    // Execute the thumbnail script //COMMENT THIS OUT FOR MILESTONE3 CHEESE
    const thumbnailCommand = `/root/videos/thumb_one_vid.sh "${permanentPath}" "${videoId}"`;
    await new Promise((resolve, reject) => {
      exec(thumbnailCommand, (thumbError, thumbStdout, thumbStderr) => {
        if (thumbError) return reject(thumbStderr);
        resolve(thumbStdout);
      });
    });

    // Update processing status in the database
    await Video.updateOne({ id: videoId }, { processing: false });

    //console.log(`Video ${videoId} processed successfully.`);
  } catch (error) {
    //console.error(`Error processing video ${videoId}:`, error);
    throw error; // Ensure Bull tracks the job as failed
  }
});
