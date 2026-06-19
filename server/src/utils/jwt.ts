import jwt, { SignOptions } from 'jsonwebtoken';
import { config } from '../config';

export type Role = 'student' | 'parent' | 'faculty' | 'admin';

export interface JwtPayload {
  userId: number;
  role: Role;
  email: string;
  studentId?: number | null;  // for student/parent scoping
  teacherId?: number | null;  // for faculty scoping
}

export function signToken(payload: JwtPayload): string {
  const options: SignOptions = { expiresIn: config.jwtExpiresIn as SignOptions['expiresIn'] };
  return jwt.sign(payload, config.jwtSecret, options);
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, config.jwtSecret) as JwtPayload;
}
