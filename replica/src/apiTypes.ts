export type Goal = 'sell' | 'fun';

export interface User {
  id: number;
  name: string;
  email: string;
  goal: Goal | null;
}

export interface SavedModel {
  id: string;
  name: string;
  widthMm: number;
  heightMm: number;
  depthMm: number;
  volumeMm3: number;
  triangles: number;
  thumbnail: string | null;
  stlBytes: number;
  createdAt: number;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface Api {
  me(): Promise<User | null>;
  signup(name: string, email: string, password: string, goal: Goal | null): Promise<User>;
  login(email: string, password: string, goal: Goal | null): Promise<User>;
  logout(): Promise<unknown>;
  setGoal(goal: Goal): Promise<User>;
  listModels(): Promise<SavedModel[]>;
  saveModel(meta: Omit<SavedModel, 'id' | 'stlBytes' | 'createdAt'>, stl: ArrayBuffer): Promise<SavedModel>;
  modelStl(id: string): Promise<ArrayBuffer>;
  deleteModel(id: string): Promise<unknown>;
}
