import Constants from "expo-constants";

type Env = {
  API_URL: string;
};

const { API_URL } = Constants.expoConfig?.extra as Env;

export const env: Env = { API_URL };