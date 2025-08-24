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

export const addOther = async (other: string) => {
    try {
        const response = await axios.post(
            'http://localhost:3000/add-other',
            { other },
            { withCredentials: true },
        );
        return response.data;
    } catch (error) {
        throw error;
    }
};

export const removeOther = async (other: string) => {
    try {
        const response = await axios.post(
            'http://localhost:3000/remove-other',
            { other },
            { withCredentials: true },
        );
        return response.data;
    } catch (error) {
        throw error;
    }
};
