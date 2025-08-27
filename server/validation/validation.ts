import { z } from 'zod';

const error = {
    usernameShort: 'Username must be at least 3 characters long.',
    usernameLong: 'Username must be at most 24 characters',
    usernameCharacters: 'Username can only contain letters and numbers',
};

export const usernameSchema = z
    .string()
    .min(3, error.usernameShort)
    .max(24, error.usernameLong)
    .regex(/^[a-zA-Z0-9_-]+$/, error.usernameCharacters);

export const passwordSchema = z.string();
// .min(12, 'Password must be at least 12 characters'),
// .regex(
//     /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).*$/,
//     'Password must contain at least one lowercase letter, one uppercase letter, one number, and one special character',
// ), // TODO: revert for prod
