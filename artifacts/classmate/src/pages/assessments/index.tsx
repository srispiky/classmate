import { useState } from "react";
import { Link } from "wouter";
import { useListAssessments } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, BrainCircuit, Target, BookOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

export default function Assessments() {
  const { data: assessments, isLoading } = useListAssessments();
  const [search, setSearch] = useState("");

  const filteredAssessments = assessments?.filter(assessment => 
    assessment.title.toLowerCase().includes(search.toLowerCase()) || 
    assessment.studentName.toLowerCase().includes(search.toLowerCase()) ||
    assessment.courseName.toLowerCase().includes(search.toLowerCase())
  ) || [];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Assessments</h1>
          <p className="text-muted-foreground mt-1">Review student performance and AI-generated insights.</p>
        </div>
      </div>

      <div className="flex items-center space-x-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search students, courses, or titles..."
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-64 rounded-xl" />)}
        </div>
      ) : filteredAssessments.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredAssessments.map(assessment => (
            <Card key={assessment.id} className="flex flex-col hover:bg-muted/50 transition-colors">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <CardTitle className="text-xl flex items-center gap-2">
                      <Target className="w-5 h-5 text-primary" />
                      {assessment.title}
                    </CardTitle>
                    <div className="text-sm text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Link href={`/students/${assessment.studentId}`} className="font-medium text-foreground hover:underline">
                        {assessment.studentName}
                      </Link>
                      <span>•</span>
                      <span className="flex items-center gap-1">
                        <BookOpen className="w-3.5 h-3.5" />
                        {assessment.courseName}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end">
                    <div className="text-2xl font-bold text-primary">{assessment.percentage}%</div>
                    <div className="text-xs text-muted-foreground">{assessment.score}/{assessment.maxScore}</div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex-1 mt-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div>
                    <h4 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-3 flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-green-500" />
                      Strengths
                    </h4>
                    <ul className="space-y-2">
                      {assessment.strengths.slice(0, 3).map((strength, i) => (
                        <li key={i} className="text-sm border-l-2 border-green-500 pl-3 py-1 bg-green-500/5 rounded-r-md">
                          {strength}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h4 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-3 flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-orange-500" />
                      Areas to Improve
                    </h4>
                    <ul className="space-y-2">
                      {assessment.weaknesses.slice(0, 3).map((weakness, i) => (
                        <li key={i} className="text-sm border-l-2 border-orange-500 pl-3 py-1 bg-orange-500/5 rounded-r-md">
                          {weakness}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
                
                <div className="mt-6 pt-4 border-t border-border flex items-center justify-between">
                  <div className="text-xs text-muted-foreground">
                    Completed {formatDate(assessment.createdAt)}
                  </div>
                  <Link href={`/students/${assessment.studentId}/ai`}>
                    <Badge variant="outline" className="cursor-pointer hover:bg-primary hover:text-primary-foreground transition-colors border-primary/30 text-primary">
                      <BrainCircuit className="w-3.5 h-3.5 mr-1" />
                      AI Insights
                    </Badge>
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center h-64 space-y-4">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <Target className="w-8 h-8 text-primary" />
            </div>
            <div className="text-center">
              <h3 className="text-lg font-semibold">No assessments found</h3>
              <p className="text-muted-foreground mt-1">Try adjusting your search query.</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
