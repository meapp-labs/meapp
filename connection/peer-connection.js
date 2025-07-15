import SignalingChannel from './signaling-channel';

export function createConnection(username) {
    const peerId = username;
    const port = process.env.PORT || 3030;
    const signalingServerUrl = 'http://localhost:' + port;
    const token = 'SIGNALING123';
    const channel = new SignalingChannel(peerId, signalingServerUrl, token);
    channel.connect();

    return channel;
}
