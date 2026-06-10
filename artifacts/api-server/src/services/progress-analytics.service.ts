/**
 * ProgressAnalyticsService
 *
 * Pure computation functions for student risk classification, score trend
 * analysis, progress timeline construction, and cohort classification.
 * All functions are stateless and DB-free — they operate only on pre-fetched
 * data so they can be unit-tested without mocks.
 *
 * Risk classification thresholds (consistent with dashboard `atRisk` threshold):
 *   INSUFFICIENT_DATA  < 3 scored events
 *   HIGH               avg < 60
 *   MEDIUM             60 ≤ avg < 80
 *   LOW                avg ≥ 80
 *
 * Trend algorithm (fixed 5-event window):
 *   INSUFFICIENT_DATA  < 5 chronological scored events
 *   Compare avg(last 3) vs avg(previous 2) within the most recent 5 events.
 *   delta > +5  → IMPROVING
 *   delta < -5  → DECLINING
 *   otherwise   → STABLE
 *
 * Cohort priority (mutually exclusive):
 *   noData     both riskLevel and trend are INSUFFICIENT_DATA
 *   atRisk     riskLevel === HIGH
 *   improving  trend === IMPROVING (not HIGH)
 *   declining  trend === DECLINING (not HIGH)
 *   (stable / insufficient on one dimension → not classified into any cohort)
 */

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "INSUFFICIENT_DATA";
export type Trend = "IMPROVING" | "STABLE" | "DECLINING" | "INSUFFICIENT_DATA";
export type TimelineEventType = "ASSIGNMENT_GRADED" | "ASSESSMENT_COMPLETED";

/** Minimum events required for a valid risk classification. */
const RISK_MIN_EVENTS = 3;

/** Minimum events required for a valid trend calculation. */
const TREND_MIN_EVENTS = 5;

/** Delta threshold (percentage points) for trend classification. */
const TREND_THRESHOLD = 5;

// ── Risk Level ────────────────────────────────────────────────────────────────

/**
 * Classifies a student's risk level based on their scored-event average.
 *
 * @param scores - Array of percentage scores (0–100). Order does not matter.
 * @returns RiskLevel enum string.
 */
export function computeRiskLevel(scores: number[]): RiskLevel {
  if (scores.length < RISK_MIN_EVENTS) {
    return "INSUFFICIENT_DATA";
  }

  const avg = scores.reduce((sum, s) => sum + s, 0) / scores.length;

  if (avg < 60) return "HIGH";
  if (avg < 80) return "MEDIUM";
  return "LOW";
}

// ── Trend ─────────────────────────────────────────────────────────────────────

/**
 * Computes score trend based on the most recent 5 chronological scored events.
 *
 * The caller must pass scores in chronological order (oldest first).
 * Only the last 5 events are used: [n-5, n-4] are "previous", [n-3, n-2, n-1]
 * are "recent". Delta = avg(recent) - avg(previous).
 *
 * @param chronologicalScores - Scores ordered oldest → newest (percentage 0–100).
 * @returns Trend enum string.
 */
export function computeTrend(chronologicalScores: number[]): Trend {
  if (chronologicalScores.length < TREND_MIN_EVENTS) {
    return "INSUFFICIENT_DATA";
  }

  const window = chronologicalScores.slice(-5);
  const previous = window.slice(0, 2);
  const recent = window.slice(2);

  const avgPrevious = previous.reduce((sum, s) => sum + s, 0) / previous.length;
  const avgRecent = recent.reduce((sum, s) => sum + s, 0) / recent.length;
  const delta = avgRecent - avgPrevious;

  if (delta > TREND_THRESHOLD) return "IMPROVING";
  if (delta < -TREND_THRESHOLD) return "DECLINING";
  return "STABLE";
}

// ── Timeline ──────────────────────────────────────────────────────────────────

export interface TimelineEventInput {
  timestamp: Date;
  type: TimelineEventType;
  title: string;
  score: number;
  maxScore: number;
  courseId: number;
  courseName: string;
}

export interface TimelineEvent {
  date: string;
  type: TimelineEventType;
  title: string;
  scorePercent: number;
  courseId: number;
  courseName: string;
}

export interface TimelineAssignmentInput {
  updatedAt: Date;
  title: string;
  score: number | null;
  maxScore: number;
  courseId: number;
  courseName: string | null;
  status: string;
  deletedAt: Date | null;
}

export interface TimelineAssessmentInput {
  createdAt: Date;
  title: string;
  score: number;
  maxScore: number;
  courseId: number;
  courseName: string | null;
  deletedAt: Date | null;
}

/**
 * Builds a chronological timeline of scored academic events.
 *
 * Assignments:  only graded (status === "graded" && score != null), not soft-deleted.
 *               Timestamp: updatedAt (grading date).
 *
 * Assessments:  all non-soft-deleted assessments.
 *               Timestamp: createdAt.
 *
 * Returned in chronological order, oldest first. Deterministic tie-breaking
 * uses event type (ASSIGNMENT_GRADED before ASSESSMENT_COMPLETED) then title.
 *
 * @param assignments - Assignment rows for the student.
 * @param assessments - Assessment rows for the student.
 * @returns TimelineEvent[] sorted oldest → newest.
 */
export function buildTimeline(
  assignments: TimelineAssignmentInput[],
  assessments: TimelineAssessmentInput[],
): TimelineEvent[] {
  const events: TimelineEventInput[] = [];

  for (const a of assignments) {
    if (a.deletedAt !== null) continue;
    if (a.status !== "graded" || a.score === null) continue;
    events.push({
      timestamp: a.updatedAt,
      type: "ASSIGNMENT_GRADED",
      title: a.title,
      score: a.score,
      maxScore: a.maxScore,
      courseId: a.courseId,
      courseName: a.courseName ?? "Unknown",
    });
  }

  for (const a of assessments) {
    if (a.deletedAt !== null) continue;
    events.push({
      timestamp: a.createdAt,
      type: "ASSESSMENT_COMPLETED",
      title: a.title,
      score: a.score,
      maxScore: a.maxScore,
      courseId: a.courseId,
      courseName: a.courseName ?? "Unknown",
    });
  }

  events.sort((a, b) => {
    const timeDiff = a.timestamp.getTime() - b.timestamp.getTime();
    if (timeDiff !== 0) return timeDiff;
    if (a.type !== b.type) return a.type.localeCompare(b.type);
    return a.title.localeCompare(b.title);
  });

  return events.map((e) => ({
    date: e.timestamp.toISOString(),
    type: e.type,
    title: e.title,
    scorePercent: Math.round((e.score / e.maxScore) * 100 * 10) / 10,
    courseId: e.courseId,
    courseName: e.courseName,
  }));
}

// ── Cohort Classification ─────────────────────────────────────────────────────

export interface StudentCohortEntry {
  id: number;
  name: string;
  /** Chronological percentage scores (0–100), oldest → newest. */
  chronologicalScores: number[];
}

export interface StudentCohortSummary {
  id: number;
  name: string;
  averageScore: number;
}

export interface StudentCohorts {
  atRisk: StudentCohortSummary[];
  improving: StudentCohortSummary[];
  declining: StudentCohortSummary[];
  noData: StudentCohortSummary[];
}

/**
 * Classifies a list of students into health cohorts.
 *
 * Priority order (mutually exclusive buckets):
 *   1. noData     — both riskLevel and trend are INSUFFICIENT_DATA
 *   2. atRisk     — riskLevel === HIGH
 *   3. improving  — trend === IMPROVING (and not HIGH risk)
 *   4. declining  — trend === DECLINING (and not HIGH risk)
 *   5. (students with STABLE trend and LOW/MEDIUM risk are not included — they are healthy)
 *
 * Reuses computeRiskLevel and computeTrend — no duplicate logic.
 *
 * @param students - Scoped student entries with pre-computed chronological scores.
 * @returns StudentCohorts with four mutually-exclusive arrays.
 */
export function classifyStudentCohorts(students: StudentCohortEntry[]): StudentCohorts {
  const atRisk: StudentCohortSummary[] = [];
  const improving: StudentCohortSummary[] = [];
  const declining: StudentCohortSummary[] = [];
  const noData: StudentCohortSummary[] = [];

  for (const student of students) {
    const scores = student.chronologicalScores;
    const riskLevel = computeRiskLevel(scores);
    const trend = computeTrend(scores);

    const averageScore =
      scores.length > 0
        ? Math.round((scores.reduce((sum, s) => sum + s, 0) / scores.length) * 10) / 10
        : 0;

    const summary: StudentCohortSummary = { id: student.id, name: student.name, averageScore };

    if (riskLevel === "INSUFFICIENT_DATA" && trend === "INSUFFICIENT_DATA") {
      noData.push(summary);
    } else if (riskLevel === "HIGH") {
      atRisk.push(summary);
    } else if (trend === "IMPROVING") {
      improving.push(summary);
    } else if (trend === "DECLINING") {
      declining.push(summary);
    }
    // STABLE with LOW/MEDIUM risk: healthy, not included in any alert cohort
  }

  return { atRisk, improving, declining, noData };
}
