import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, assessmentsTable, studentsTable, coursesTable, activityTable } from "@workspace/db";
import {
  CreateAssessmentBody,
  GetAiSuggestionsParams,
  GetAiSuggestionsResponse,
  GetStudentAiSuggestionsParams,
  GetStudentAiSuggestionsResponse,
  ListAssessmentsQueryParams,
  ListAssessmentsResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

function serializeAssessment(
  a: typeof assessmentsTable.$inferSelect,
  studentName: string,
  courseName: string
) {
  const percentage = Math.round((a.score / a.maxScore) * 100 * 10) / 10;
  return {
    ...a,
    studentName,
    courseName,
    percentage,
    strengths: a.strengths as string[],
    weaknesses: a.weaknesses as string[],
    createdAt: a.createdAt.toISOString(),
  };
}

function generateAiSuggestions(
  assessments: Array<typeof assessmentsTable.$inferSelect>,
  studentName: string,
  studentId: number
) {
  const allWeaknesses: string[] = [];
  const allStrengths: string[] = [];

  for (const a of assessments) {
    allWeaknesses.push(...(a.weaknesses as string[]));
    allStrengths.push(...(a.strengths as string[]));
  }

  const avgScore =
    assessments.length > 0
      ? assessments.reduce((sum, a) => sum + (a.score / a.maxScore) * 100, 0) / assessments.length
      : 0;

  const uniqueWeaknesses = [...new Set(allWeaknesses)];
  const uniqueStrengths = [...new Set(allStrengths)];

  const suggestions: Array<{ area: string; priority: string; suggestion: string; relatedTopic: string | null }> =
    uniqueWeaknesses.slice(0, 5).map((area, i) => ({
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

router.get("/assessments", async (req, res): Promise<void> => {
  const queryParams = ListAssessmentsQueryParams.safeParse(req.query);
  if (!queryParams.success) {
    res.status(400).json({ error: queryParams.error.message });
    return;
  }

  const conditions = [];
  if (queryParams.data.studentId)
    conditions.push(eq(assessmentsTable.studentId, queryParams.data.studentId));
  if (queryParams.data.courseId)
    conditions.push(eq(assessmentsTable.courseId, queryParams.data.courseId));

  const assessments = await db
    .select()
    .from(assessmentsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(assessmentsTable.createdAt);

  const enriched = await Promise.all(
    assessments.map(async (a) => {
      const [student] = await db
        .select({ name: studentsTable.name })
        .from(studentsTable)
        .where(eq(studentsTable.id, a.studentId));
      const [course] = await db
        .select({ name: coursesTable.name })
        .from(coursesTable)
        .where(eq(coursesTable.id, a.courseId));
      return serializeAssessment(a, student?.name ?? "Unknown", course?.name ?? "Unknown");
    })
  );

  res.json(ListAssessmentsResponse.parse(enriched));
});

router.post("/assessments", async (req, res): Promise<void> => {
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

  const [assessment] = await db.insert(assessmentsTable).values(parsed.data).returning();

  await db.insert(activityTable).values({
    type: "assessment_completed",
    description: `Assessment "${parsed.data.title}" completed with score ${parsed.data.score}/${parsed.data.maxScore}`,
    studentName: student?.name ?? "Unknown",
    courseName: course?.name ?? "Unknown",
  });

  res.status(201).json(
    serializeAssessment(assessment, student?.name ?? "Unknown", course?.name ?? "Unknown")
  );
});

router.get("/assessments/:id/ai-suggestions", async (req, res): Promise<void> => {
  const params = GetAiSuggestionsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [assessment] = await db
    .select()
    .from(assessmentsTable)
    .where(eq(assessmentsTable.id, params.data.id));
  if (!assessment) {
    res.status(404).json({ error: "Assessment not found" });
    return;
  }

  const [student] = await db
    .select({ name: studentsTable.name })
    .from(studentsTable)
    .where(eq(studentsTable.id, assessment.studentId));

  const allAssessments = await db
    .select()
    .from(assessmentsTable)
    .where(eq(assessmentsTable.studentId, assessment.studentId));

  const suggestions = generateAiSuggestions(allAssessments, student?.name ?? "Unknown", assessment.studentId);
  res.json(GetAiSuggestionsResponse.parse(suggestions));
});

router.get("/students/:id/ai-suggestions", async (req, res): Promise<void> => {
  const params = GetStudentAiSuggestionsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [student] = await db
    .select({ name: studentsTable.name })
    .from(studentsTable)
    .where(eq(studentsTable.id, params.data.id));
  if (!student) {
    res.status(404).json({ error: "Student not found" });
    return;
  }

  const assessments = await db
    .select()
    .from(assessmentsTable)
    .where(eq(assessmentsTable.studentId, params.data.id));

  const suggestions = generateAiSuggestions(assessments, student.name, params.data.id);
  res.json(GetStudentAiSuggestionsResponse.parse(suggestions));
});

export default router;
