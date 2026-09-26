/**
 * API paths double as react-query keys. Values are paths relative to the API
 * root — api.ts prefixes `/api/` automatically.
 */
export const Keys = {
  Query: {
    GET_FRIENDS: 'get-others',
    FRIEND_REQUESTS: 'friend-requests',
    IGNORED_USERS: 'ignored-users',
    GET_MESSAGES: 'get-messages',
    GET_CONVERSATIONS: 'conversations',
    ME: 'me',
  },
  Mutation: {
    SEND_MESSAGE: 'send-message',
    CREATE_CONVERSATION: 'conversations',
    LOGIN: 'login',
    REGISTER: 'register',
    LOGOUT: 'logout',
    ADD_FRIEND: 'add-other',
    ACCEPT_FRIEND_REQUEST: 'friend-requests/accept',
    IGNORE_FRIEND_REQUEST: 'friend-requests/ignore',
    UNIGNORE_USER: 'ignored-users/remove',
    REMOVE_FRIEND: 'remove-other',
    PUSH_TOKEN: 'push-token',
  },
} as const
