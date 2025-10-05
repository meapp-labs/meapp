import { z } from 'zod';

const error = {
  usernameShort: 'Username must be at least 3 characters long.',
  usernameLong: 'Username must be at most 24 characters',
  usernameCharacters: 'Username can only contain letters and numbers',
  emailNotValid: 'Please enter a valid email address.',
  passwordShort: 'Password must be at least 8 characters long.',
  passwordLong: 'Password must be less than 128 characters.',
  passwordsNoMatch: 'Passwords do not match.',
  passwordHasUsername: 'Password can not have username inside.',
};

const passwordValidation = z.string();
// .min(8, error.passwordShort)
// .max(128, error.passwordLong);
// .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
// .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
// .regex(/[0-9]/, 'Password must contain at least one number')
// .regex(
//     /[^a-zA-Z0-9]/,
//     'Password must contain at least one special character',
// )
// .refine(
//     (password) => !/(.)\1{2,}/.test(password),
//     'Password cannot contain more than 2 consecutive identical characters',
// )
// .refine(
//     (password) =>
//         !/^(password|123456|qwerty|admin|letmein)$/i.test(password),
//     'Password cannot be a common weak password',
// ); // TODO: Revert for prod

const usernameValidation = z
  .string()
  .min(3, error.usernameShort)
  .max(24, error.usernameLong)
  .regex(/^[a-zA-Z0-9]+$/, error.usernameCharacters);

export const LoginSchema = z
  .object({
    username: usernameValidation,
    password: passwordValidation,
  })
  .refine((data) => !data.password.includes(data.username), {
    message: error.passwordHasUsername,
    path: ['password'],
  });

export type LoginType = z.infer<typeof LoginSchema>;

export const RegisterSchema = z
  .object({
    username: usernameValidation,
    email: z.email(error.emailNotValid),
    password: passwordValidation,
    confirmPassword: passwordValidation,
  })
  .refine((data) => !data.password.includes(data.username), {
    message: error.passwordHasUsername,
    path: ['password'],
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: error.passwordsNoMatch,
    path: ['confirmPassword'],
  });

export type RegisterType = z.infer<typeof RegisterSchema>;
