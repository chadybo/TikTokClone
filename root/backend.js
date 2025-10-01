const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const app = express();
const path = require('path');
const cors = require('cors');
const courseID = '66e0a169bf8a61f7a31c143a';
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const multer = require('multer');
const { exec } = require('child_process');
const Queue = require('bull');

app.use(express.json());

app.use(cors({
    origin: '*',
    methods: '*',
    credentials: true,
    allowedHeaders: '*'
}));

app.use((req, res, next) => {
    console.log(`${req.method} ${req.url} - ${JSON.stringify(req.body)}`);
    next();
});

app.options('*', (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', '*');
    res.header('Access-Control-Allow-Headers', '*');
    res.sendStatus(204);
});

const dbURI = 'mongodb://admin:tryanDHac23435356UsN0WUca34ntdoitANymOreBcUZ2349874456472POlk89@0.0.0.0:27017/dataBase?authSource=admin';
const options = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
};

mongoose.connect(dbURI, options)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

app.use(session({
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: 'mongodb://admin:tryanDHac23435356UsN0WUca34ntdoitANymOreBcUZ2349874456472POlk89@0.0.0.0:27017/sessionDatabase?authSource=admin',
  }),
 cookie: { 
    sameSite: 'Lax', 
    httpOnly: true, 
    maxAge: 3600000
  }
}));

const videoQueue = new Queue('video-processing', {
  redis: { host: '127.0.0.1', port: 6379 }, // Update host/port if Redis is remote
});

const dbWriteQueue = new Queue('db-write-queue', {
  redis: { host: '127.0.0.1', port: 6379 },
});

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  verified: { type: Boolean, default: false },
  verificationKey: { type: String, required: true },
  watchedVideos: {type: [String], default: []},
  uploadedVideos: {type: [String], default: []}
});

const User = mongoose.model('User', userSchema);

const videoSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true},   //removed unique: true //in mongosh I dropped the index ID_1 by doing
  title: String,                         //db.videos.getIndexes(); and then db.videos.dropIndex('id_1');
  description: String,
  likes: { type: [String], default: [] },
  dislikes: { type: [String], default: [] },
  views: {type: Number, default: 0},
  processing: {type: Boolean, default: true},
  author: { type: String }
});

const Video = mongoose.model('Video', videoSchema);


const transporter = nodemailer.createTransport({
  host: '130.245.136.52',
  port: 25,
  secure: false,
  tls: {
    rejectUnauthorized: false
  }
});

//this is for the index for tracking video position when we infinitely scroll down to the last videp

app.use('/thumbnails', express.static(path.join(__dirname, 'thumbnails')));

app.post('/api/videos', async (req, res) => {
  const { count, videoId } = req.body;
  const userId = req.session.userId;

  try {
      const currentUser = await User.findById(userId);

      if (!currentUser) {
          return res.status(404).json({ error: 'User not found' });
      }

      const watchedVideos = new Set(currentUser.watchedVideos);
      const likedUsers = videoId
          ? await Video.findOne({ id: videoId }).select('likes')
          : { likes: [] };
      // Fetch all videos
      const likedUserFilter = likedUsers.likes || [];
      const videos = await Video.find({
          likes: { $in: likedUserFilter },
          id: { $nin: Array.from(watchedVideos) },
      });

      // Build video-user matrix
      const videoUserMatrix = {};
      videos.forEach(video => {
          videoUserMatrix[video.id] = {};
          video.likes.forEach(user => {
              videoUserMatrix[video.id][user] = 1;
          });
          video.dislikes.forEach(user => {
              videoUserMatrix[video.id][user] = -1;
          });
      });

      let recommendedVideos = new Set();

      if (videoId) {
        // Item-based collaborative filtering
        const targetVideoUsers = videoUserMatrix[videoId] || {};
        const videoSimilarities = [];
        for (const [otherVideoId, userRatings] of Object.entries(videoUserMatrix)) {
            if (otherVideoId !== videoId) {
                const similarity = calculateCosineSimilarity(targetVideoUsers, userRatings);
                  if (similarity > 0) videoSimilarities.push({ videoId: otherVideoId, similarity });
            }
        }
        // Sort videos by similarity and filter out already watched videos
        videoSimilarities.sort((a, b) => b.similarity - a.similarity);
    
        videoSimilarities.forEach(({ videoId }) => {
            recommendedVideos.add(videoId);
            if (recommendedVideos.size >= count) return;
        });
        // console.log("======================= similarity table", videoSimilarities)
        // console.log("----------------- curr recomended vids", recommendedVideos);
    }
    

      if (!videoId || recommendedVideos.size < count) {
          // User-based collaborative filtering (fallback or default)
          const userPreferences = {};
          videos.forEach(video => {
              video.likes.forEach(user => {
                  if (!userPreferences[user]) userPreferences[user] = {};
                  userPreferences[user][video.id] = 1;
              });
              video.dislikes.forEach(user => {
                  if (!userPreferences[user]) userPreferences[user] = {};
                  userPreferences[user][video.id] = -1;
              });
          });

          const currentUserPrefs = userPreferences[userId] || {};
          const userSimilarities = [];

          for (const [user, prefs] of Object.entries(userPreferences)) {
              if (user !== userId) {
                  const similarity = calculateCosineSimilarity(currentUserPrefs, prefs);
                  if (similarity > 0) userSimilarities.push({ user, similarity });
              }
          }

          userSimilarities.sort((a, b) => b.similarity - a.similarity);

          for (const { user } of userSimilarities) {
              const prefs = userPreferences[user];
              for (const [vidId, liked] of Object.entries(prefs)) {
                  if (liked === 1 && !watchedVideos.has(vidId)) {
                      recommendedVideos.add(vidId);
                      if (recommendedVideos.size >= count) break;
                  }
              }
              if (recommendedVideos.size >= count) break;
          }
      }

      // Populate recommended videos
      let recommendedVideoDocs = [];
      const recommendedVideoIds = new Set();
      if (recommendedVideos.size > 0) {
        const recommendedVideoArray = Array.from(recommendedVideos); // Convert Set to an array
        recommendedVideoDocs = [];
    
        for (const videoId of recommendedVideoArray) {
          // Fetch each video one at a time
          const video = await Video.findOne({ id: videoId }).select('id title description likes dislikes');
          if (video) {
            recommendedVideoIds.add(video.id); // Keep track of already added videos
            const watched = watchedVideos.has(video.id);
            const liked = video.likes.includes(userId)
                ? true
                : (video.dislikes.includes(userId) ? false : null);
            const likevalues = video.likes.length - video.dislikes.length;

            recommendedVideoDocs.push({
                id: video.id,
                description: video.description,
                title: video.title,
                watched,
                liked,
                likevalues,
            });
            // Stop if we have enough videos
            if (recommendedVideoDocs.length >= count) break;
          }
        }
      }
    

      // Add random unwatched videos if recommendations are insufficient
      if (recommendedVideoDocs.length < count) {
          const remainingCount = count - recommendedVideoDocs.length;
          const fallbackVideos = await Video.aggregate([
              { $match: { id: { $nin: Array.from(watchedVideos).concat(Array.from(recommendedVideoIds)) }/*, processing: false*/ } },
              { $sample: { size: remainingCount } }
          ]);

          const formattedFallbackVideos = fallbackVideos
              .filter(video => !recommendedVideoIds.has(video.id))
              .map(video => {
                  recommendedVideoIds.add(video.id);
                  const watched = watchedVideos.has(video.id);
                  const liked = video.likes.includes(userId) ? true : (video.dislikes.includes(userId) ? false : null);
                  const likevalues = video.likes.length - video.dislikes.length;

                  return {
                      id: video.id,
                      description: video.description,
                      title: video.title,
                      watched,
                      liked,
                      likevalues,
                  };
              });

          recommendedVideoDocs = recommendedVideoDocs.concat(formattedFallbackVideos);
      }

      // Final fallback if still not enough videos: Add random watched videos
      if (recommendedVideoDocs.length < count) {
          const watchedFallback = await Video.aggregate([
             // { $match: { processing: false } },
              { $sample: { size: count - recommendedVideoDocs.length } }
          ]);

          const formattedWatchedFallback = watchedFallback
              .filter(video => !recommendedVideoIds.has(video.id))
              .map(video => {
                  recommendedVideoIds.add(video.id);
                  const watched = watchedVideos.has(video.id);
                  const liked = video.likes.includes(userId) ? true : (video.dislikes.includes(userId) ? false : null);
                  const likevalues = video.likes.length - video.dislikes.length;

                  return {
                      id: video.id,
                      description: video.description,
                      title: video.title,
                      watched,
                      liked,
                      likevalues,
                  };
              });

          recommendedVideoDocs = recommendedVideoDocs.concat(formattedWatchedFallback);
      }
      // console.log("final list", recommendedVideoDocs);
      res.status(200).json({ status: "OK", videos: recommendedVideoDocs });
  } catch (error) {
      res.status(500).json({ status: "ERROR", error: error.message });
  }
});

// Helper function to calculate cosine similarity
function calculateCosineSimilarity(vectorA, vectorB) {
  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;

  const allKeys = new Set([...Object.keys(vectorA), ...Object.keys(vectorB)]);
  for (const key of allKeys) {
      const valA = vectorA[key] || 0;
      const valB = vectorB[key] || 0;

      dotProduct += valA * valB;
      magnitudeA += valA * valA;
      magnitudeB += valB * valB;
  }

  magnitudeA = Math.sqrt(magnitudeA);
  magnitudeB = Math.sqrt(magnitudeB);

  if (magnitudeA === 0 || magnitudeB === 0) return 0;
  return dotProduct / (magnitudeA * magnitudeB);
}

// app.post('/api/videos', async (req, res) => {
//   const { count, videoId } = req.body;
//   const userId = req.session.userId;

//   try {
//       // Parallel fetch of user and videos data
//       const [currentUser, videos] = await Promise.all([
//           User.findById(userId),
//           Video.find().select('id title description likes dislikes')
//       ]);

//       if (!currentUser) {
//           return res.status(404).json({ error: 'User not found' });
//       }

//       if (videos.length === 0) {
//           return res.status(404).json({ error: 'No videos available' });
//       }

//       const watchedVideos = new Set(currentUser.watchedVideos);

//       // Pre-compute video-user matrix and user preferences
//       const videoUserMatrix = {};
//       const userPreferences = {};
      
//       // Single pass to build both matrices
//       videos.forEach(video => {
//           videoUserMatrix[video.id] = {};
          
//           video.likes.forEach(user => {
//               videoUserMatrix[video.id][user] = 1;
//               if (!userPreferences[user]) userPreferences[user] = {};
//               userPreferences[user][video.id] = 1;
//           });
          
//           video.dislikes.forEach(user => {
//               videoUserMatrix[video.id][user] = -1;
//               if (!userPreferences[user]) userPreferences[user] = {};
//               userPreferences[user][video.id] = -1;
//           });
//       });

//       let recommendedVideos = new Set();

//       // Item-based collaborative filtering with memoization
//       if (videoId) {
//           const targetVideoUsers = videoUserMatrix[videoId] || {};
//           const videoSimilarities = await Promise.all(
//               Object.entries(videoUserMatrix)
//                   .filter(([otherVideoId]) => otherVideoId !== videoId)
//                   .map(async ([otherVideoId, userRatings]) => {
//                       const similarity = calculateCosineSimilarity(targetVideoUsers, userRatings);
//                       return { videoId: otherVideoId, similarity };
//                   })
//           );

//           videoSimilarities
//               .filter(({ similarity }) => similarity > 0)
//               .sort((a, b) => b.similarity - a.similarity)
//               .some(({ videoId }) => {
//                   if (!watchedVideos.has(videoId)) recommendedVideos.add(videoId);
//                   return recommendedVideos.size >= count;
//               });
//       }

//       // User-based collaborative filtering with memoization
//       if (recommendedVideos.size < count) {
//           const currentUserPrefs = userPreferences[userId] || {};
//           const userSimilarities = await Promise.all(
//               Object.entries(userPreferences)
//                   .filter(([user]) => user !== userId)
//                   .map(async ([user, prefs]) => {
//                       const similarity = calculateCosineSimilarity(currentUserPrefs, prefs);
//                       return { user, similarity, prefs };
//                   })
//           );

//           userSimilarities
//               .filter(({ similarity }) => similarity > 0)
//               .sort((a, b) => b.similarity - a.similarity)
//               .forEach(({ user, prefs }) => {
//                   if (recommendedVideos.size >= count) return;
//                   Object.entries(prefs).forEach(([vidId, liked]) => {
//                       if (liked === 1 && !watchedVideos.has(vidId)) {
//                           recommendedVideos.add(vidId);
//                       }
//                   });
//               });
//       }

//       // Create a video lookup map
//       const videoMap = new Map(videos.map(video => [video.id, video]));

//       // Format recommended videos in parallel
//       const recommendedVideoIds = new Set();
//       const recommendedVideoDocs = await Promise.all(
//           Array.from(recommendedVideos)
//               .slice(0, count)
//               .map(async (videoId) => {
//                   const video = videoMap.get(videoId);
//                   if (!video) return null;

//                   recommendedVideoIds.add(video.id);
//                   return {
//                       id: video.id,
//                       description: video.description,
//                       title: video.title,
//                       watched: watchedVideos.has(video.id),
//                       liked: video.likes.includes(userId)
//                           ? true
//                           : video.dislikes.includes(userId)
//                           ? false
//                           : null,
//                       likevalues: video.likes.length - video.dislikes.length,
//                   };
//               })
//       ).then(results => results.filter(Boolean));

//       // Handle fallback videos if needed
//       if (recommendedVideoDocs.length < count) {
//           const remainingCount = count - recommendedVideoDocs.length;
//           const excludedIds = [...watchedVideos, ...recommendedVideoIds].map(String);
          
//           const [fallbackVideos, watchedFallback] = await Promise.all([
//               Video.aggregate([
//                   { $match: { id: { $nin: excludedIds } } },
//                   { $sample: { size: remainingCount } }
//               ]),
//               recommendedVideoDocs.length + remainingCount < count
//                   ? Video.aggregate([
//                       { $sample: { size: count - (recommendedVideoDocs.length + remainingCount) } }
//                   ])
//                   : Promise.resolve([])
//           ]);

//           const formatVideo = (video) => ({
//               id: video.id,
//               description: video.description,
//               title: video.title,
//               watched: watchedVideos.has(video.id),
//               liked: video.likes.includes(userId)
//                   ? true
//                   : video.dislikes.includes(userId)
//                   ? false
//                   : null,
//               likevalues: video.likes.length - video.dislikes.length,
//           });

//           const fallbackDocs = [
//               ...fallbackVideos,
//               ...watchedFallback
//           ]
//               .filter(video => !recommendedVideoIds.has(video.id))
//               .map(formatVideo);

//           recommendedVideoDocs.push(...fallbackDocs);
//       }

//       res.status(200).json({
//           status: "OK",
//           videos: recommendedVideoDocs.slice(0, count)
//       });
//   } catch (error) {
//       res.status(500).json({ status: "ERROR", error: error.message });
//   }
// });

// // Helper function to calculate cosine similarity
// function calculateCosineSimilarity(vectorA, vectorB) {
//   // Early exit for empty vectors
//   if (!Object.keys(vectorA).length || !Object.keys(vectorB).length) return 0;
  
//   let dotProduct = 0;
//   let magnitudeA = 0;
//   let magnitudeB = 0;
  
//   // Only iterate through keys that exist in vectorA (non-zero values)
//   // This reduces iterations for sparse vectors
//   for (const key in vectorA) {
//       const valA = vectorA[key];
//       const valB = vectorB[key] || 0;
      
//       if (valA !== 0) {
//           dotProduct += valA * valB;
//           magnitudeA += valA * valA;
//       }
//   }
  
//   // If magnitudeA is 0, we can return early
//   if (magnitudeA === 0) return 0;
  
//   // Calculate magnitudeB separately to avoid checking unused values
//   for (const key in vectorB) {
//       const valB = vectorB[key];
//       if (valB !== 0) {
//           magnitudeB += valB * valB;
//       }
//   }
  
//   // If magnitudeB is 0, we can return early
//   if (magnitudeB === 0) return 0;
  
//   // Use Math.sqrt only once at the end
//   return dotProduct / (Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB));
// }



// app.post('/api/like', async (req, res) => {
//   res.set('X-CSE356', courseID);
//   const { id, value } = req.body;

//   if (!req.session.userId) {
//       return res.status(200).json({ status: "ERROR", error: true, message: "User not logged in." });
//   }

//   const userId = req.session.userId;

//   try {
//       const video = await Video.findOne({ id });
//       if (!video) {
//           return res.status(200).json({ status: "ERROR", error: true, message: "Video not found." });
//       }

//       const isAlreadyLiked = video.likes.includes(userId);
//       const isAlreadyDisliked = video.dislikes.includes(userId);

//       if ((value === true && isAlreadyLiked) || (value === false && isAlreadyDisliked) || (value === null && !isAlreadyLiked && !isAlreadyDisliked)) {
//           return res.status(200).json({ status: "ERROR", error: true, message: "Value already set to this state." });
//       }

//       video.likes = video.likes.filter(user => user !== userId);
//       video.dislikes = video.dislikes.filter(user => user !== userId);

//       if (value === true) {
//           video.likes.push(userId);
//       } else if (value === false) {
//           video.dislikes.push(userId);
//       }

//       await video.save();

//       res.status(200).json({ status: "OK", likes: video.likes.length});
//   } catch (error) {
//       console.error(error);
//       res.status(200).json({ status: "ERROR", error: true, message: "Internal server error." });
//   }
// });

app.post('/api/like', async (req, res) => {
  res.set('X-CSE356', courseID);

  const { id, value } = req.body;

  if (!req.session.userId) {
      return res.status(200).json({ status: "ERROR", error: true, message: "User not logged in." });
  }

  // Validate input early
  if (![true, false, null].includes(value)) {
      return res.status(200).json({ status: "ERROR", error: true, message: "Invalid value." });
  }

  const userId = req.session.userId;

  try {
      // Use atomic update operations
      const update = {};
      if (value === true) {
          update.$addToSet = { likes: userId };
          update.$pull = { dislikes: userId };
      } else if (value === false) {
          update.$addToSet = { dislikes: userId };
          update.$pull = { likes: userId };
      } else if (value === null) {
          update.$pull = { likes: userId, dislikes: userId };
      }

      const result = await Video.updateOne({ id }, update);

      if (result.modifiedCount === 0) {
          return res.status(200).json({ status: "ERROR", error: true, message: "Value already set to this state." });
      }

      // Fetch the updated likes count
      const video = await Video.findOne({ id }, 'likes');
      res.status(200).json({ status: "OK", likes: video.likes.length });
  } catch (error) {
      console.error(error);
      res.status(200).json({ status: "ERROR", error: true, message: "Internal server error." });
  }
});


app.post('/api/adduser', async (req, res) => {
  const { username, password, email } = req.body;

  res.set('X-CSE356', courseID);
  const existingUser = await User.findOne({ $or: [{ username }, { email }] });
  if (existingUser) {
    return res.status(200).json({ status: "ERROR", message: "Username or email already exists" });
  }

  
   function generateRandomKey(length) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        const randomIndex = Math.floor(Math.random() * chars.length);
        result += chars[randomIndex];
    }
    return result;
    }

   const verificationKey = generateRandomKey(10);

  const newUser = new User({
    username,
    password: password,
    email,
    verified: false,
    verificationKey
  });

  await newUser.save();

  const verificationLink = `http://130.245.136.210/api/verify?email=${encodeURIComponent(email)}&key=${verificationKey}`;

  const mailOptions = {
  from: 'no-reply@rams.cse356.compas.cs.stonybrook.edu',
  to: email,
  subject: 'Email Verification',
  text: 'Please click the link to verify your account:',
  html: `<p>Please click the link to verify your account:</p> <a href="${verificationLink}">${verificationLink}</a>`
};
  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error('Error sending email:', error);
      return res.status(200).json({ status: "ERROR", "error": true, message: "Failed to send verification email" });
    }
    // console.log('Verification email sent:', info.response);
    res.status(200).json({ status: "OK", message: "User created, verification email sent" });
  });
});

function isAuthenticated(req, res, next) {
    // console.log("I am in isAuten function");
    // console.log(req.session);
    // console.log(req.session.userId);
    if (req.session && req.session.userId) {
        req.isAuthenticated = true;
        return next();
    }
    req.isAuthenticated = false;
    next();
}

app.get('/', isAuthenticated, (req, res) => {
    res.set('X-CSE356', courseID);
    // console.log("I AM IN THE / .GET");
    // console.log(req.isAuthenticated);
    if (!req.isAuthenticated) {
       return res.sendFile(path.join('/var/www/html/','login.html'));
    }

    res.sendFile(path.join('/var/www/html/','home.html'));
});

app.get('/api/videos_for_home', (req, res) => {
    const videosDir = path.join(__dirname, 'videos');
    fs.readdir(videosDir, (err, files) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Unable to retrieve videos' });
        }
        
        // console.log("This is files in videoes for home");
        // console.log(files);

        const videos = files
            .filter(file => file.endsWith('.mp4'))
            .map(file => path.parse(file).name);
        
        res.json(videos);
    });
});

app.post('/api/view' , isAuthenticated, async(req,res) => {
      //console.log("XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");
      //console.log("XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");
      //console.log("XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");
      //console.log("XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");
      //console.log("I AM IN THE VIEW POST REQUEST BABY");
      //console.log("THIS IS ID: ", req.body);
      //console.log("XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");
      //console.log("XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");
      //console.log("XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");
      //console.log("XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");
     res.set('X-CSE356', courseID);
     const {id} = req.body;
     const user = await User.findById(req.session.userId);

       //console.log("THIS IS USER");
       //console.log(user);
       //console.log("THIS IS ID: ", id);
       //console.log("THIS IS WATCHEDVIDEOS: ", user.toObject().watchedVideos);
     if(user.watchedVideos.includes(id)){
          //console.log("INSIDE THE IF STATEMENT");
          //console.log("THIS IS IF THERE IS A VIDEOID IN WATCHED VIDEOS: ",user.watchedVideos.includes(id));
 	       return res.status(200).json({ status: "OK", viewed: true });
     }

      //console.log("HERE AFTER THE IF STATEMENT"); 

      user.watchedVideos.push(id);
      //console.log("THIS IS IF THERE IS NO VIDEOID IN WATCHED VIDEOS: ",user.watchedVideos.includes(id));
      //console.log("THIS IS USER.WATCHEDVIDEOS");
      //console.log(user.watchedVideos);  

     await user.save();

     res.status(200).json({ status:'OK', viewed: false });

});


//THESE ARE THE OLD MEDIA ENDPOINTS AND WILL NOW BE COMMENTED OUT

//app.get('/api/media/:id/output.mpd', isAuthenticated, (req, res) => {
//  const videoId = req.params.id;
//  console.log("HELLO IM HERE MOM");
//  res.set('X-CSE356', courseID);
//  res.sendFile(path.join('/var/www/', 'media/', '${videoId}/','output.mpd'));
//});

//app.get('/api/media/:id/chunk:bandwidth:segmentNumber.m4s', (req, res) => {
//  const { bandwidth, segmentNumber } = req.params;
//  const videoId = req.params.id;
//  res.set('X-CSE356', courseID);
//  console.log(segmentNumber);
//  console.log(bandwidth);
//  const filePath = path.join('/var/www/', `media/${videoId}/chunk_${segmentNumber}.m4s`);
//  res.sendFile(filePath);
//});

//END OF THE OLD MEDIA ENDPOINTS

app.get('/api/verify', async (req, res) => {
  const { email, key } = req.query;
   res.set('X-CSE356', courseID);
  const user = await User.findOne({ email, verificationKey: key });
  if (!user) {
    return res.status(200).json({ status: "ERROR", "error": true, message: "Invalid verification link" });
  }

  user.verified = true;
  await user.save();
  res.status(200).json({status: "OK"});
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  // console.log(password);
  // console.log(username);
  res.set('X-CSE356', courseID);

  const user = await User.findOne({ username });
  if (!user || !user.verified) {
    // console.log(user);
    return res.status(200).json({ status: "ERROR", message: "Invalid username or account not verified" });
  }

  if (password !== user.password) {
    return res.status(200).json({ status: "ERROR", error: true, message: "Invalid password" });
  }

  req.session.userId = user._id;
  req.session.username = user.username;
  // console.log("THIS IS THE USER ID IN LOGIN");
  // console.log(req.session.userId);
  // console.log("SENDING HOME.HTML");
  return res.status(200).json({status: "OK" });
});

app.post('/home', isAuthenticated, async (req, res) => {
    // console.log("IM IN /HOME");
    // console.log("THIS IS THE USER ID IN HOME");
    // console.log(req.session.userId);

    // console.log("THIS IS AUTHENTICATED IN HOME");
    // console.log(req.isAuthenticated);

    if(req.isAuthenticated){
        // console.log("HEELO I HAVE A COOKIE");
        // console.log(req.session.userId);
        return res.sendFile(path.join('/var/www/html/', 'home.html'));
    }
});


app.get('/upload', isAuthenticated, (req, res) => {
      res.set('X-CSE356', courseID);
     //if(req.isAuthenticated){
      return res.sendFile(path.join('/var/www/html', 'upload.html'));
     //}
});


app.post('/api/logout', (req, res) => {
  // console.log("I CAME INTO LOGOUT");
  res.set('X-CSE356', courseID);
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ status: "ERROR", "error": true, message: "Failed to log out" });
    }

    res.clearCookie('connect.sid');
    res.status(200).json({ status: "OK", message: "Logout successful" });
  });
});

app.post('/api/check-auth', (req,res) => {
   res.set('X-CSE356', courseID);
   
   if(req.session && req.session.userId){
	res.status(200).json({
   	   status: 'OK',
	   isLoggedIn: true,
	   userId: req.session.userId,
   	});
   }
   else{
	res.status(200).json({
	   status: 'OK',
	   isLoggedIn: false,
	   userId: null,
   	});
   }
});

app.get('/api/manifest/:id', isAuthenticated, (req, res) => {
    const { id } = req.params;
    res.set('X-CSE356', courseID);
    // console.log("Request for manifest/initialization with ID:", id);
    // console.log("I AM IN MANIFEST");

    if (!req.isAuthenticated) {
       return res.status(200).json({ status: "ERROR", error: true, message: "You are not logged in" });
    }

    if (id.endsWith('.m4s')) {
       const manifestPath = path.join('/var/www/media', `${id}`);

      //  console.log("initialization file sending");
      //  console.log(manifestPath);
       res.set('Content-Type', 'application/dash+xml');
       res.sendFile(manifestPath);
    }
    else{
       const manifestPath = path.join('/var/www/media', `${id}.mpd`);

      //  console.log("manifest sending");
      //  console.log(manifestPath);
       res.set('Content-Type', 'application/dash+xml');
       res.sendFile(manifestPath);
    }
});

app.get('/media/:id', (req, res) => {
  const { id } = req.params;
  res.set('X-CSE356', courseID);
  // console.log("IN THE MEDIA ENDPOINT");
  // console.log(id);
  const filePath = path.join('/var/www/media', `${id}`);
  res.sendFile(filePath);
});

const getManifestUrlById = (id) => {
	return `/api/manifest/${id}`;
}

app.get('/play/:id', (req, res) => {
        res.set('X-CSE356', courseID);
	// console.log("IN PLAY BEFORE GETTING MANIFEST URL");
	const videoId = req.params.id;
	const manifestUrl = getManifestUrlById(videoId);
	// console.log("IN PLAY AFTER GETTING MANIFEST URL");
	// console.log(manifestUrl);
	fs.readFile(path.join('/var/www/html', 'video_player.html'), `utf8`, (err, data) => {
		const htmlContent = data
	            .replace(/{{MANIFEST_URL}}/g, manifestUrl)
        	    .replace(/{{VIDEO_ID}}/g, videoId)
              .replace(/{{VIDEO_ID_FOR_VIEW}}/g, videoId);

		res.send(htmlContent);
	});

});

// app.get('/api/thumbnail/:id', (req, res) => {
//     res.set('X-CSE356', courseID);
//     const videoId = req.params.id;
//     const videoPath = path.join(__dirname, 'videos', `${videoId}.mp4`);
//     const thumbnailPath = path.join(__dirname, 'thumbnails', `${videoId}.jpg`);

//     if (fs.existsSync(thumbnailPath)) {
// 	       res.set('X-CSE356', courseID);
//         return res.sendFile(thumbnailPath);
//     }

//     ffmpeg(videoPath)
//         .on('end', () => {
// 	    res.set('X-CSE356', courseID);
//             res.sendFile(thumbnailPath);
//         })
//         .on('error', (err) => {
//             console.error(err);
// 	    res.set('X-CSE356', courseID);
//            res.status(500).send('Error generating thumbnail');
//        })
//         .screenshots({
//             count: 1,
//             folder: path.join(__dirname, 'thumbnails'),
//             filename: `${videoId}.jpg`,
//             size: '320x180',
// 	    timemarks: [0]
//         })
// });

app.get('/api/thumbnail/:id', (req, res) => {
  res.set('X-CSE356', courseID);
  const videoId = req.params.id;
  const thumbnailPath = path.join(__dirname, 'thumbnails', `${videoId}.jpg`);

  if (fs.existsSync(thumbnailPath)) {
      return res.sendFile(thumbnailPath);
  } else {
      return res.status(404).send('Thumbnail not found');
  }
});


const upload = multer({
  dest: '/root/videos',
  limits: { fileSize: 1000 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'video/mp4') {
      cb(null, true);
    } else {
      cb(new Error('Only MP4 files are allowed'));
    }
  },
});

app.post('/api/upload', upload.single('mp4File'), async (req, res) => {
  res.set('X-CSE356', courseID);
  const { author, title, description } = req.body;
  const uploadedFilePath = req.file.path;
  const filename = req.file.originalname;
  const prefix = path.basename(filename, '.mp4');
  const timestamp = Date.now();
  const uniqueVideoId = `${prefix}_${timestamp}`;
  // console.log("unique id", uniqueVideoId);

  // try {
  //   // Save new video details to the database
  //   const newVideo = new Video({
  //     id: uniqueVideoId,
  //     title: title,
  //     description: description,
  //     author: author,
  //     processing: true,
  //   });
  //   // console.log("this is the newvid being save", newVideo);
  //   await newVideo.save({ writeConcern: { w: 1 } });
  
  // try {
  //   // Add database write to the queue
  //   await dbWriteQueue.add({
  //     video: {
  //       id: uniqueVideoId,
  //       title,
  //       description,
  //       author,
  //       processing: true,
  //     },
  //   });

  try {
    // Save new video details to the database
    const newVideo = new Video({
      id: uniqueVideoId,
      title: title,
      description: description,
      author: author,
      processing: true,
    });
    // console.log("this is the newvid being save", newVideo);
    await newVideo.save({ writeConcern: { w: 1 } });

    const userId = req.session.userId;
    await User.updateOne(
      { _id: userId },
      { $addToSet: { uploadedVideos: uniqueVideoId } }
    );

    // Add job to the Bull queue
    await videoQueue.add({
      videoId: uniqueVideoId,
      filePath: uploadedFilePath,
      permanentFileName: `${prefix}_${timestamp}.mp4`,
    });

    // console.log("sending OK");
    res.status(200).json({ status: 'OK', id: uniqueVideoId });
  } catch (error) {
    console.error('Error adding video to the queue:', error);
    res.status(200).json({
      status: 'ERROR',
      error: true,
      message: 'Failed to add video to the queue.',
    });
  }
});

// videoQueue.process(async (job) => {
//   const { videoId, filePath, permanentFileName } = job.data;
//   //console.log("THIS IS IN THE WORKER QUEUE. I AM PROCESSING:", videoId);
//   try {
//     const permanentPath = `/root/videos/${permanentFileName}`;

//     // Move the uploaded file to the permanent location
//     await new Promise((resolve, reject) => {
//       fs.rename(filePath, permanentPath, (err) => {
//         if (err) return reject(err);
//         resolve();
//       });
//     });

//     // Execute the chunking script
//     const command = `/root/videos/chunk_one_vid.sh "${permanentPath}" "${videoId}"`;
//     await new Promise((resolve, reject) => {
//       exec(command, { cwd: '/root/videos' }, (error, stdout, stderr) => {
//         if (error) return reject(stderr);
//         resolve();
//       });
//     });

//     // Execute the thumbnail script
//     const thumbnailCommand = `/root/videos/thumb_one_vid.sh "${permanentPath}" "${videoId}"`;
//     await new Promise((resolve, reject) => {
//       exec(thumbnailCommand, (thumbError, thumbStdout, thumbStderr) => {
//         if (thumbError) return reject(thumbStderr);
//         resolve();
//       });
//     });

//     // Update processing status in the database
//     await Video.updateOne({ id: videoId }, { processing: false });

//     //console.log(`Video ${videoId} processed successfully.`);
//   } catch (error) {
//     console.error(`Error processing video ${videoId}:`, error);
//     throw error; // Ensure Bull tracks the job as failed
//   }
// });

app.get('/api/processing-status', async (req, res) => {
  res.set('X-CSE356', courseID);

  try {
    //console.log("This is user id in processing-status");
    //console.log(req.session.userId);

    const user = await User.findById(req.session.userId, 'uploadedVideos');
    if (!user || !user.uploadedVideos) {
      return res.status(200).json({
        status: 'ERROR',
        error: true,
        message: 'User not found or no uploaded videos.',
      });
    }

    const videos = await Video.find({ id: { $in: user.uploadedVideos } }, 'id title processing');

     res.status(200).json({
      status: 'OK',
      videos: videos.map((video) => ({
        id: video.id,
        title: video.title,
        status: video.processing ? 'processing' : 'complete',
      })),
    });
  } catch (error) {
    console.error('Error fetching processing status:', error);
    res.status(200).json({
      status: 'ERROR',
      error: true,
      message: 'Failed to fetch processing status.',
    });
  }
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
});
