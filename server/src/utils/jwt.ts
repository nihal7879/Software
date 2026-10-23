import jwt, { SignOptions } from 'jsonwebtoken';
import { config } from '../config';

export type Role = 'student' | 'parent' | 'faculty' | 'admin' | 'superadmin';

export interface JwtPayload {
  userId: number;
  role: Role;
  email: string;
  studentId?: number | null;  // for student/parent scoping
  teacherId?: number | null;  // for faculty scoping
  // The account's token version when this token was signed. A password reset
  // raises the account's number, and requireAuth refuses anything older — which
  // is how a reset signs the other devices out. Missing on tokens handed out
  // before this existed, and those are read as version 0.
  tv?: number;
}

export function signToken(payload: JwtPayload): string {
  // A student's lasts longer — see config.ts for why. A password change still
  // kills it immediately, whatever its expiry, through the token version.
  const expiresIn = payload.role === 'student' ? config.jwtExpiresInStudent : config.jwtExpiresIn;
  const options: SignOptions = { expiresIn: expiresIn as SignOptions['expiresIn'] };
  return jwt.sign(payload, config.jwtSecret, options);
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, config.jwtSecret) as JwtPayload;
}














































