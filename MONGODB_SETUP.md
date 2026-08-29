# ValerisBank demo - MongoDB version

1. Create a MongoDB Atlas cluster.
2. Create a database user.
3. Copy the Node.js connection string.
4. In Render, add:
   - MONGODB_URI
   - MONGODB_DB (optional; defaults to valerisbank)
5. Deploy.

The server stores each user's profile and dashboard data in the `users` collection.
Do not expose MONGODB_URI in frontend files.
