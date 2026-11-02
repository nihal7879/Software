import jwt, { SignOptions } from 'jsonwebtoken';
import { randomBytes } from 'crypto';
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
  // This token's own id, so signing out can cancel this one token and no
  // other (utils/session.ts). Missing on tokens from before; those simply
  // cannot be cancelled one by one, and run out on their own.
  jti?: string;
  // Set by jsonwebtoken: when the token runs out, in seconds.
  exp?: number;
}

export function signToken(payload: JwtPayload): { token: string; exp: number } {
  // The same for every role — see config.ts for why. A password change still
  // kills it immediately, whatever its expiry, through the token version.
  const { exp: _exp, jti: _jti, ...claims } = payload as any;
  const options: SignOptions = {
    expiresIn: config.sessionLength as SignOptions['expiresIn'],
    jwtid: randomBytes(16).toString('hex'),
  };
  const token = jwt.sign(claims, config.jwtSecret, options);
  return { token, exp: (jwt.decode(token) as any).exp };
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, config.jwtSecret) as JwtPayload;
}














































