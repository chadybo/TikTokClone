# CloudPlay
CloudPlay is a cloud-based video sharing platform that allows users to upload and watch short-form videos, similar to Instagram Reels, YouTube Shorts, or TikTok.

Originally, CloudPlay was hosted on an Ubuntu 22.04 server, utilizing Nginx as a reverse proxy and was secured using CertBot. To handle intensive video uploads and API calls related to video files, Nginx was configured with round-robin load balancing. 

### 📂 Features:
- **User Authentication**: Users can sign up and will be sent an email verification before they can login.
- **Homepage**: Users will be recommended 10 videos that they would likely enjoy on their homepage suggested through a collaborative filtering recommendation algorithm.
- **Video Upload System**: Users can post videos as long as they are within the specified size in the Nginx configurations.
- **Like/Dislike**: Each video can be liked or disliked by a logged in user.
- **Video Scrolling**: When users click on a video, it will preload 10 more videos in advance to improve Quality of Service (QoS). These 10 videos are all recommended videos from the collaborative filtering recommendation algorithm. The user can scroll to the next video to watch it, or they can scroll to the previous video to view it again.

### 🔧 Tech Stack:
- **Frontend**: JavaScript, HTML, CSS, Dash.js
- **Backend**: Node.js, Express.js
- **Database**: MongoDB (Mongoose)
- **Video Processing**: FFmpeg, Bull Queue (with Redis)
- **Email Verification**: Postfix, Nodemailer

### 🚀 Running the project:
To run the project without a load balancer, follow these steps:

1. Start a Ubuntu 22.04 cloud server and install Nginx:
   - sudo apt update
   - sudo apt install nginx

2. Install and start Redis:
   - sudo apt install redis-server
   - sudo systemctl start redis-server

3. Install FFmpeg:
   - sudo apt install ffmpeg

4. Instll Postfix:
   - sudo apt install postfix
   
5. Install npm:
   - sudo apt install nodejs npm

6. The required dependencies are listed in package.json. Install the dependencies:
   - npm install

7. Refer to the file paths shown in the repository and place all of the files from this repository into their respective file paths.

8. Install and start the mongoDB database and start mongosh

9. Start the backend server:
   - node backend.js
