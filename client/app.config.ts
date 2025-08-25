import "dotenv/config";

export default {
  expo: {
    name: "my-app",
    slug: "my-app",
    extra: {
      API_URL: process.env.API_URL,
      API_KEY: process.env.API_KEY,
    },
  },
};