import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, assessmentsTable, studentsTable, coursesTable, activityTable } from "@workspace/db";
import {
  CreateAssessmentBody,
  GetAssessmentParams,
  GetAssessmentResponse,
  GetAiSuggestionsParams,
  GetAiSuggestionsResponse,
  GetStudentAiSuggestionsParams,
  GetStudentAiSuggestionsResponse,
  ListAssessmentsQueryParams,
  ListAssessmentsResponse,
} from "@workspace/api-zod";
import { buildScopeContext, type ClassmateSession } from "../lib/scope-context";
import { ownershipDenied } from "../lib/query-contracts";
import {
  listAssessments,
  getAssessmentById,
  listAssessmentsForStudent,
  type AssessmentRow,
} from "../lib/assessments.queries";
import { assessmentPolicy, PolicyAuthorizationError } from "../lib/policies";

const router: IRouter = Router();

function serializeAssessment(a: AssessmentRow) {
  const percentage = Math.round((a.score / a.maxScore) * 100 * 10) / 10;
  return {
    id: a.id,
    studentId: a.studentId,
    studentName: a.studentName,
    courseId: a.courseId,
    courseName: a.courseName,
    title: a.title,
    score: a.score,
    maxScore: a.maxScore,
    percentage,
    strengths: a.strengths,
    weaknesses: a.weaknesses,
    createdAt: a.createdAt.toISOString(),
  };
}

function generateAiSuggestions(
  assessments: AssessmentRow[],
  studentName: string,
  studentId: number,
) {
  const allWeaknesses: string[] = [];
  const allStrengths: string[] = [];

  for (const a of assessments) {
    allWeaknesses.push(...a.weaknesses);
    allStrengths.push(...a.strengths);
  }

  const avgScore =
    assessments.length > 0
      ? assessments.reduce((sum, a) => sum + (a.score / a.maxScore) * 100, 0) / assessments.length
      : 0;

  const uniqueWeaknesses = [...new Set(allWeaknesses)];
  const uniqueStrengths = [...new Set(allStrengths)];

  const suggestions: Array<{
    area: string;
    priority: string;
    suggestion: string;
    relatedTopic: string | null;
  }> = uniqueWeaknesses.slice(0, 5).map((area, i) => ({
    area,
    priority: i === 0 ? "high" : i <= 2 ? "medium" : "low",
    suggestion: `Focus on improving your understanding of ${area}. Review the relevant lesson notes and practice exercises.`,
    relatedTopic: area,
  }));

  if (avgScore < 60) {
    suggestions.unshift({
      area: "Overall Performance",
      priority: "high",
      suggestion:
        "Your overall scores indicate a need for additional support. Consider requesting one-on-one tutoring sessions.",
      relatedTopic: null,
    });
  } else if (avgScore < 75) {
    suggestions.push({
      area: "Consistency",
      priority: "medium",
      suggestion:
        "You're performing at a satisfactory level but there's room for improvement. Focus on topics where you scored below average.",
      relatedTopic: null,
    });
  }

  if (suggestions.length === 0) {
    suggestions.push({
      area: "Advanced Topics",
      priority: "low",
      suggestion:
        "Excellent performance! Consider exploring advanced topics in your courses to stay challenged and deepen your understanding.",
      relatedTopic: null,
    });
  }

  return {
    studentId,
    studentName,
    overallScore: Math.round(avgScore * 10) / 10,
    suggestions: suggestions.slice(0, 6),
    recommendedTopics: uniqueWeaknesses.slice(0, 4),
    strengths: uniqueStrengths.slice(0, 4),
    generatedAt: new Date().toISOString(),
  };
}

// ── GET /api/assessments ─────────────────────────────────────────────────────

router.get("/assessments", async (req, res): Promise<void> => {
  const scope = buildScopeContext(req.session as ClassmateSession);

  const queryParams = ListAssessmentsQueryParams.safeParse(req.query);
  if (!queryParams.success) {
    res.status(400).json({ error: queryParams.error.message });
    return;
  }

  // Layer 2 applied inside listAssessments() via assessmentPolicy.getScopeCondition()
  const assessments = await listAssessments(scope, {
    studentId: queryParams.data.studentId,
    courseId: queryParams.data.courseId,
  });

  res.json(ListAssessmentsResponse.parse(assessments.map(serializeAssessment)));
});

// ── POST /api/assessments ────────────────────────────────────────────────────

router.post("/assessments", async (req, res): Promise<void> => {
  const scope = buildScopeContext(req.session as ClassmateSession);
  const parsed = CreateAssessmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [student] = await db
    .select({ name: studentsTable.name })
    .from(studentsTable)
    .where(eq(studentsTable.id, parsed.data.studentId));

  const [course] = await db
    .select({ name: coursesTable.name })
    .from(coursesTable)
    .where(eq(coursesTable.id, parsed.data.courseId));

  const [assessment] = await db
    .insert(assessmentsTable)
    .values({ ...parsed.data, createdBy: scope.userId })
    .returning();

  await db.insert(activityTable).values({
    type: "assessment_completed",
    description: `Assessment "${parsed.data.title}" completed with score ${parsed.data.score}/${parsed.data.maxScore}`,
    studentName: student?.name ?? "Unknown",
    courseName: course?.name ?? "Unknown",
  });

  res.status(201).json(
    serializeAssessment({
      ...assessment,
      studentName: student?.name ?? "Unknown",
      courseName: course?.name ?? "Unknown",
      deletedAt: null,
    }),
  );
});

// ── GET /api/assessments/:id ─────────────────────────────────────────────────

router.get("/assessments/:id", async (req, res): Promise<void> => {
  const scope = buildScopeContext(req.session as ClassmateSession);

  const params = GetAssessmentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const assessment = await getAssessmentById(params.data.id);
  if (!assessment) {
    res.status(404).json({ error: "Assessment not found" });
    return;
  }

  // Layer 3: delegate ownership check to AssessmentScopePolicy.
  // Services do not contain authorization rules — policies own that logic.
  try {
    assessmentPolicy.validateAccess(scope, assessment);
  } catch (err) {
    if (err instanceof PolicyAuthorizationError) {
      res.status(403).json(ownershipDenied("assessment", params.data.id));
      return;
    }
    throw err;
  }

  res.json(GetAssessmentResponse.parse(serializeAssessment(assessment)));
});

// ── GET /api/assessments/:id/ai-suggestions ──────────────────────────────────

router.get("/assessments/:id/ai-suggestions", async (req, res): Promise<void> => {
  const scope = buildScopeContext(req.session as ClassmateSession);

  const params = GetAiSuggestionsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const assessment = await getAssessmentById(params.data.id);
  if (!assessment) {
    res.status(404).json({ error: "Assessment not found" });
    return;
  }

  // Layer 3: same policy as the detail endpoint — access to AI suggestions
  // is gated by the same student-ownership rules as the assessment itself.
  try {
    assessmentPolicy.validateAccess(scope, assessment);
  } catch (err) {
    if (err instanceof PolicyAuthorizationError) {
      res.status(403).json(ownershipDenied("assessment", params.data.id));
      return;
    }
    throw err;
  }

  const allAssessments = await listAssessmentsForStudent(assessment.studentId);
  const suggestions = generateAiSuggestions(allAssessments, assessment.studentName, assessment.studentId);
  res.json(GetAiSuggestionsResponse.parse(suggestions));
});

// ── GET /api/students/:id/ai-suggestions ─────────────────────────────────────

router.get("/students/:id/ai-suggestions", async (req, res): Promise<void> => {
  const scope = buildScopeContext(req.session as ClassmateSession);

  const params = GetStudentAiSuggestionsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  // Layer 3: student-level access check via assessmentPolicy.
  // Uses the structural { studentId } interface — the policy delegates to
  // canAccessStudentResource which checks scope.studentId / childStudentIds.
  try {
    assessmentPolicy.validateAccess(scope, { studentId: params.data.id });
  } catch (err) {
    if (err instanceof PolicyAuthorizationError) {
      res.status(403).json(ownershipDenied("student", params.data.id));
      return;
    }
    throw err;
  }

  const [student] = await db
    .select({ name: studentsTable.name })
    .from(studentsTable)
    .where(eq(studentsTable.id, params.data.id));
  if (!student) {
    res.status(404).json({ error: "Student not found" });
    return;
  }

  const assessments = await listAssessmentsForStudent(params.data.id);
  const suggestions = generateAiSuggestions(assessments, student.name, params.data.id);
  res.json(GetStudentAiSuggestionsResponse.parse(suggestions));
});

export default router;
