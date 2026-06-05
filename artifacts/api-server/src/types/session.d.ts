import "express-session";

declare module "express-session" {
  interface SessionData {
    userId: number;
    username: string;
    displayName: string;
    role: string;
    permissions: string[];
    permissionsVersion: number;
    studentId: number;
    enrolledCourseIds: number[];
    childStudentIds: number[];
    childCourseIds: number[];
    teacherId: number;
    ownedCourseIds: number[];
  }
}
