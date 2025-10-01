const Queue = require('bull');

// Connect to your queue
const videoQueue = new Queue('video-processing', {
  redis: { host: '127.0.0.1', port: 6379 }, // Adjust host/port as needed
});

(async () => {
  try {
    // Clear jobs from specific states
    await videoQueue.clean(0, 'completed'); // Clear all completed jobs
    await videoQueue.clean(0, 'failed');    // Clear all failed jobs
    await videoQueue.obliterate({ force: true }); // Clear waiting/delayed/active jobs (irreversible!)

    console.log('Queue cleared successfully.');
  } catch (err) {
    console.error('Error clearing queue:', err);
  }
})();
