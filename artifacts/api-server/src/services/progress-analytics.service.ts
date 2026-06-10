/**
 * ProgressAnalyticsService
 *
 * Pure computation functions for student risk classification, score trend
 * analysis, and progress timeline construction. All functions are stateless
 * and DB-free — they operate only on pre-fetched data so they can be
 * unit-tested without mocks.
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
