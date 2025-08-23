import axios from 'axios';

export const getOthers = async (from: string) => {
    try {
        const response = await axios.get('http://localhost:3000/get-others', {
            params: { from },
            withCredentials: true,
        });
        return response.data;
    } catch (error) {
        throw error;
    }
};
