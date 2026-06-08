import {
  getStudentDisplayName,
  getStudentDashboardCounts,
} from "../lib/student-dashboard.queries";
import type { ScopeContext } from "../lib/scope-context";

export interface StudentDashboardDTO {
  studentId: number;
  displayName: string;
  activeCourseCount: number;
  totalAssignments: number;
  pendingAssignments: number;
  totalAssessments: number;
  upcomingAssessments: number;
  unreadAnnouncements: number;
  availableNotes: number;
}

/**
 * StudentDashboardService — aggregates dashboard metrics for a student.
 *
 * Responsibilities:
 *   - Validate that the scope carries a linked student record
 *   - Coordinate repository calls
 *   - Compose the dashboard DTO
 *
 * Authorization is enforced by the controller (requireRole) before this
 * service is invoked. The service enforces the additional business rule that
 * the session must be linked to an actual student record (scope.studentId != null).
 */
export class StudentDashboardService {
  /**
   * Builds the student dashboard for the authenticated student.
   *
   * Returns null when:
   *   - scope.studentId is null (account not linked to a student record)
   *   - no student row found for scope.studentId (record deleted or never created)
   *
   * The controller maps null → 404.
   */
  static async getDashboard(scope: ScopeContext): Promise<StudentDashboardDTO | null> {
    const { studentId, enrolledCourseIds } = scope;
    if (studentId === null) return null;

    const displayName = await getStudentDisplayName(studentId);
    if (displayName === null) return null;

    const counts = await getStudentDashboardCounts(studentId, enrolledCourseIds);

    return {
      studentId,
      displayName,
      ...counts,
    };
  }
}
