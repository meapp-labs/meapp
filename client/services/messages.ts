import { TMessage } from '@/components/chat/Message';
import axios from 'axios';

export interface MessageData {
    to: string;
    text: string;
}

export const sendMessage = async (messageData: MessageData) => {
    try {
        const response = await axios.post(
            'http://localhost:3000/send-message',
            messageData,
            {
                withCredentials: true,
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

export async function getMessages(from: string): Promise<TMessage[]> {
    try {
        const response = await axios.get('http://localhost:3000/get-messages', {
            params: { from },
            withCredentials: true,
        });
        return response.data;
    } catch (error) {
        throw error;
    }
}
