const Queue = require('bull');
const mongoose = require('mongoose');

// MongoDB connection
const dbURI = 'mongodb://admin:tryanDHac23435356UsN0WUca34ntdoitANymOreBcUZ2349874456472POlk89@0.0.0.0:27017/dataBase?authSource=admin';
const options = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
};

mongoose.connect(dbURI, options)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));



// Video schema
const videoSchema = new mongoose.Schema({
  id: String,
  title: String,
  description: String,
  author: String,
  processing: Boolean,
});
const Video = mongoose.model('Video', videoSchema);

// Redis-based Bull queue
const dbWriteQueue = new Queue('db-write-queue', {
  redis: { host: '127.0.0.1', port: 6379 },
});

// Process database write jobs
dbWriteQueue.process(async (job) => {
  const { video } = job.data;
  try {
    const newVideo = new Video(video);
    await newVideo.save({ writeConcern: { w: 1 } });
    console.log(`Video ${video.id} saved to the database.`);
  } catch (error) {
    console.error(`Error saving video ${video.id}:`, error);
    throw error; // Requeue job on failure
  }
});
