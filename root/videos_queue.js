const Queue = require('bull');

// Connect to your queue
const videoQueue = new Queue('video-processing', {
  redis: { host: '127.0.0.1', port: 6379 },
});

(async () => {
  try {
    // Get jobs in various states
    const waiting = await videoQueue.getWaiting(); // Jobs waiting to be processed
    const active = await videoQueue.getActive();   // Jobs currently being processed
    //const completed = await videoQueue.getCompleted(); // Jobs that completed successfully
    const failed = await videoQueue.getFailed();   // Jobs that failed

    console.log('Waiting Jobs:', waiting);
    console.log('Active Jobs:', active);
    //console.log('Completed Jobs:', completed);
    console.log('Failed Jobs:', failed);
  } catch (err) {
    console.error('Error inspecting queue:', err);
  }
})();
