import { useParams, Link } from "wouter";
import { useGetStudent, getGetStudentQueryKey, useGetStudentAiSuggestions, getGetStudentAiSuggestionsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BrainCircuit, ArrowLeft, Target, Lightbulb, BookOpen, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

export default function StudentAi() {
  const params = useParams();
  const id = parseInt(params.id || "0", 10);

  const { data: student, isLoading: isLoadingStudent } = useGetStudent(id, {
    query: { enabled: !!id, queryKey: getGetStudentQueryKey(id) }
  });

  const { data: aiData, isLoading: isLoadingAi } = useGetStudentAiSuggestions(id, {
    query: { enabled: !!id, queryKey: getGetStudentAiSuggestionsQueryKey(id) }
  });

  if (isLoadingStudent || isLoadingAi) {
    return (
      <div className="space-y-6 max-w-5xl mx-auto">
        <Skeleton className="h-10 w-48" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Skeleton className="h-48" />
          <Skeleton className="h-48 md:col-span-2" />
        </div>
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!student) {
    return <div>Student not found</div>;
  }

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20';
      case 'medium': return 'bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20';
      case 'low': return 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href={`/students/${student.id}`}>
            <Button variant="outline" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">AI Insights</h1>
            <p className="text-muted-foreground mt-1">Personalized learning analysis for {student.name}</p>
          </div>
        </div>
      </div>

      {!aiData ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center h-64 space-y-4">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <BrainCircuit className="w-8 h-8 text-primary" />
            </div>
            <div className="text-center">
              <h3 className="text-lg font-semibold">No AI Insights Available</h3>
              <p className="text-muted-foreground mt-1">More assessment data is needed to generate insights.</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="bg-primary text-primary-foreground overflow-hidden relative">
              <div className="absolute right-0 top-0 -mr-8 -mt-8 w-32 h-32 rounded-full bg-white/10 blur-2xl" />
              <div className="absolute left-0 bottom-0 -ml-8 -mb-8 w-24 h-24 rounded-full bg-black/10 blur-xl" />
              <CardHeader className="relative z-10 pb-2">
                <CardTitle className="text-primary-foreground/80 text-sm font-medium uppercase tracking-wider flex items-center gap-2">
                  <Target className="w-4 h-4" />
                  Overall Performance
                </CardTitle>
              </CardHeader>
              <CardContent className="relative z-10">
                <div className="text-5xl font-bold">{aiData.overallScore}%</div>
                <div className="mt-4 text-primary-foreground/80 text-sm">
                  Generated {formatDate(aiData.generatedAt)}
                </div>
              </CardContent>
            </Card>

            <Card className="md:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center gap-2">
                  <BookOpen className="w-5 h-5 text-primary" />
                  Recommended Topics to Review
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2 mt-2">
                  {aiData.recommendedTopics.map((topic, i) => (
                    <Badge key={i} variant="secondary" className="px-3 py-1.5 text-sm font-medium">
                      {topic}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <Lightbulb className="w-5 h-5 text-amber-500" />
                Actionable Suggestions
              </h2>
              
              <div className="space-y-4">
                {aiData.suggestions.map((suggestion, i) => (
                  <Card key={i} className="border-l-4 overflow-hidden" style={{ 
                    borderLeftColor: suggestion.priority === 'high' ? 'hsl(var(--destructive))' : 
                                     suggestion.priority === 'medium' ? '#f59e0b' : 
                                     '#10b981' 
                  }}>
                    <CardContent className="p-6">
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-4">
                        <div>
                          <h3 className="font-semibold text-lg">{suggestion.area}</h3>
                          {suggestion.relatedTopic && (
                            <div className="text-sm text-muted-foreground mt-1 flex items-center gap-1.5">
                              <BookOpen className="w-3.5 h-3.5" />
                              Related to: <span className="font-medium text-foreground">{suggestion.relatedTopic}</span>
                            </div>
                          )}
                        </div>
                        <Badge variant="outline" className={getPriorityColor(suggestion.priority)}>
                          {suggestion.priority} priority
                        </Badge>
                      </div>
                      <p className="text-foreground leading-relaxed">
                        {suggestion.suggestion}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>

            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Target className="w-5 h-5 text-green-500" />
                    Key Strengths
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-3">
                    {aiData.strengths.map((strength, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <div className="mt-1 w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                        <span>{strength}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>

              <Card className="bg-muted/50 border-dashed">
                <CardContent className="p-6 text-center text-sm text-muted-foreground">
                  <AlertCircle className="w-6 h-6 mx-auto mb-2 opacity-50" />
                  <p>AI suggestions are generated based on recent assessment data, assignment scores, and overall class performance.</p>
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
