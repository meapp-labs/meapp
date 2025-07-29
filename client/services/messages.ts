import axios from 'axios';

export interface MessageData {
    from: string;
    text: string;
}

export const sendMessage = async (messsageData: MessageData) => {
    try {
        const response = await axios.post(
            'http://localhost:3000/send-message',
            messsageData,
            {
                headers: {
                    'Content-Type': 'application/json',
                },
            },
        );
        return response.data;
    } catch (error) {
        throw error;
    }
};
