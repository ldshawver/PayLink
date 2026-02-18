import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Company, Worker, Review, Qualification } from "@shared/schema";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Star,
  Plus,
  TrendingUp,
  Award,
  Zap,
  GraduationCap,
  IdCard,
  BadgeCheck,
  Languages,
  ClipboardList,
} from "lucide-react";

function useTabParam(defaultTab: string): [string, (tab: string) => void] {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const params = new URLSearchParams(search);
  const tab = params.get("tab") || defaultTab;
  const setTab = (newTab: string) => {
    setLocation(`/hr?tab=${newTab}`);
  };
  return [tab, setTab];
}

function RatingStars({ rating }: { rating: number | null }) {
  if (!rating) return <span className="text-muted-foreground">N/A</span>;
  return (
    <div className="flex gap-0.5" data-testid={`rating-stars-${rating}`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={`h-4 w-4 ${i <= rating ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"}`}
        />
      ))}
    </div>
  );
}

function ReviewsTab() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [workerId, setWorkerId] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [reviewDate, setReviewDate] = useState("");
  const [reviewerName, setReviewerName] = useState("");
  const [rating, setRating] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState("pending");

  const { data: reviews, isLoading: reviewsLoading } = useQuery<Review[]>({
    queryKey: ["/api/reviews"],
  });

  const { data: workers } = useQuery<Worker[]>({
    queryKey: ["/api/workers"],
  });

  const { data: companies } = useQuery<Company[]>({
    queryKey: ["/api/companies"],
  });

  const createReview = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/reviews", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/reviews"] });
      setOpen(false);
      resetForm();
      toast({ title: "Review created successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error creating review", description: error.message, variant: "destructive" });
    },
  });

  function resetForm() {
    setWorkerId("");
    setCompanyId("");
    setReviewDate("");
    setReviewerName("");
    setRating("");
    setNotes("");
    setStatus("pending");
  }

  function handleSubmit() {
    createReview.mutate({
      workerId,
      companyId,
      reviewDate,
      reviewerName,
      rating: rating ? parseInt(rating) : null,
      notes,
      status,
    });
  }

  const workerMap = new Map((workers || []).map((w) => [w.id, w]));

  if (reviewsLoading) {
    return (
      <div className="space-y-3" data-testid="reviews-loading">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-lg font-semibold">Performance Reviews</h3>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-review">
              <Plus className="h-4 w-4 mr-2" />
              Add Review
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Review</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Employee</Label>
                <Select value={workerId} onValueChange={setWorkerId}>
                  <SelectTrigger data-testid="select-review-worker">
                    <SelectValue placeholder="Select employee" />
                  </SelectTrigger>
                  <SelectContent>
                    {(workers || []).map((w) => (
                      <SelectItem key={w.id} value={w.id}>
                        {w.firstName} {w.lastName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Company</Label>
                <Select value={companyId} onValueChange={setCompanyId}>
                  <SelectTrigger data-testid="select-review-company">
                    <SelectValue placeholder="Select company" />
                  </SelectTrigger>
                  <SelectContent>
                    {(companies || []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Review Date</Label>
                <Input
                  type="date"
                  value={reviewDate}
                  onChange={(e) => setReviewDate(e.target.value)}
                  data-testid="input-review-date"
                />
              </div>
              <div className="space-y-2">
                <Label>Reviewer Name</Label>
                <Input
                  value={reviewerName}
                  onChange={(e) => setReviewerName(e.target.value)}
                  placeholder="Enter reviewer name"
                  data-testid="input-reviewer-name"
                />
              </div>
              <div className="space-y-2">
                <Label>Rating</Label>
                <Select value={rating} onValueChange={setRating}>
                  <SelectTrigger data-testid="select-review-rating">
                    <SelectValue placeholder="Select rating" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 Star</SelectItem>
                    <SelectItem value="2">2 Stars</SelectItem>
                    <SelectItem value="3">3 Stars</SelectItem>
                    <SelectItem value="4">4 Stars</SelectItem>
                    <SelectItem value="5">5 Stars</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger data-testid="select-review-status">
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Enter review notes"
                  data-testid="input-review-notes"
                />
              </div>
              <Button
                onClick={handleSubmit}
                disabled={createReview.isPending}
                className="w-full"
                data-testid="button-submit-review"
              >
                {createReview.isPending ? "Creating..." : "Create Review"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Review Date</TableHead>
                <TableHead>Reviewer</TableHead>
                <TableHead>Rating</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(reviews || []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No reviews found
                  </TableCell>
                </TableRow>
              ) : (
                (reviews || []).map((review) => {
                  const worker = workerMap.get(review.workerId);
                  return (
                    <TableRow key={review.id} data-testid={`row-review-${review.id}`}>
                      <TableCell data-testid={`text-review-employee-${review.id}`}>
                        {worker ? `${worker.firstName} ${worker.lastName}` : review.workerId}
                      </TableCell>
                      <TableCell data-testid={`text-review-date-${review.id}`}>
                        {review.reviewDate}
                      </TableCell>
                      <TableCell data-testid={`text-review-reviewer-${review.id}`}>
                        {review.reviewerName || "N/A"}
                      </TableCell>
                      <TableCell>
                        <RatingStars rating={review.rating} />
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            review.status === "completed"
                              ? "default"
                              : review.status === "cancelled"
                                ? "destructive"
                                : "secondary"
                          }
                          data-testid={`badge-review-status-${review.id}`}
                        >
                          {review.status}
                        </Badge>
                      </TableCell>
                      <TableCell
                        className="max-w-[200px] truncate"
                        data-testid={`text-review-notes-${review.id}`}
                      >
                        {review.notes || "—"}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function QualificationsTab() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [companyId, setCompanyId] = useState("");
  const [workerId, setWorkerId] = useState("");
  const [type, setType] = useState("skill");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [level, setLevel] = useState("");
  const [expirationDate, setExpirationDate] = useState("");

  const { data: qualifications, isLoading } = useQuery<Qualification[]>({
    queryKey: ["/api/qualifications"],
  });

  const { data: workers } = useQuery<Worker[]>({
    queryKey: ["/api/workers"],
  });

  const { data: companies } = useQuery<Company[]>({
    queryKey: ["/api/companies"],
  });

  const createQualification = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/qualifications", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/qualifications"] });
      setOpen(false);
      resetForm();
      toast({ title: "Qualification created successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error creating qualification", description: error.message, variant: "destructive" });
    },
  });

  function resetForm() {
    setCompanyId("");
    setWorkerId("");
    setType("skill");
    setName("");
    setDescription("");
    setLevel("");
    setExpirationDate("");
  }

  function handleSubmit() {
    createQualification.mutate({
      companyId,
      workerId: workerId || null,
      type,
      name,
      description: description || null,
      level: level || null,
      expirationDate: expirationDate || null,
    });
  }

  const workerMap = new Map((workers || []).map((w) => [w.id, w]));

  if (isLoading) {
    return (
      <div className="space-y-3" data-testid="qualifications-loading">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-lg font-semibold">Qualifications</h3>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-qualification">
              <Plus className="h-4 w-4 mr-2" />
              Add Qualification
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Qualification</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Company</Label>
                <Select value={companyId} onValueChange={setCompanyId}>
                  <SelectTrigger data-testid="select-qualification-company">
                    <SelectValue placeholder="Select company" />
                  </SelectTrigger>
                  <SelectContent>
                    {(companies || []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Employee</Label>
                <Select value={workerId} onValueChange={setWorkerId}>
                  <SelectTrigger data-testid="select-qualification-worker">
                    <SelectValue placeholder="Select employee" />
                  </SelectTrigger>
                  <SelectContent>
                    {(workers || []).map((w) => (
                      <SelectItem key={w.id} value={w.id}>
                        {w.firstName} {w.lastName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger data-testid="select-qualification-type">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="skill">Skill</SelectItem>
                    <SelectItem value="certification">Certification</SelectItem>
                    <SelectItem value="license">License</SelectItem>
                    <SelectItem value="education">Education</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Qualification name"
                  data-testid="input-qualification-name"
                />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Description"
                  data-testid="input-qualification-description"
                />
              </div>
              <div className="space-y-2">
                <Label>Level</Label>
                <Select value={level} onValueChange={setLevel}>
                  <SelectTrigger data-testid="select-qualification-level">
                    <SelectValue placeholder="Select level" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="beginner">Beginner</SelectItem>
                    <SelectItem value="intermediate">Intermediate</SelectItem>
                    <SelectItem value="advanced">Advanced</SelectItem>
                    <SelectItem value="expert">Expert</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Expiration Date</Label>
                <Input
                  type="date"
                  value={expirationDate}
                  onChange={(e) => setExpirationDate(e.target.value)}
                  data-testid="input-qualification-expiration"
                />
              </div>
              <Button
                onClick={handleSubmit}
                disabled={createQualification.isPending}
                className="w-full"
                data-testid="button-submit-qualification"
              >
                {createQualification.isPending ? "Creating..." : "Create Qualification"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Level</TableHead>
                <TableHead>Expiration Date</TableHead>
                <TableHead>Active</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(qualifications || []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No qualifications found
                  </TableCell>
                </TableRow>
              ) : (
                (qualifications || []).map((qual) => {
                  const worker = qual.workerId ? workerMap.get(qual.workerId) : null;
                  return (
                    <TableRow key={qual.id} data-testid={`row-qualification-${qual.id}`}>
                      <TableCell data-testid={`text-qualification-employee-${qual.id}`}>
                        {worker ? `${worker.firstName} ${worker.lastName}` : qual.workerId || "—"}
                      </TableCell>
                      <TableCell data-testid={`text-qualification-name-${qual.id}`}>
                        {qual.name}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" data-testid={`badge-qualification-type-${qual.id}`}>
                          {qual.type}
                        </Badge>
                      </TableCell>
                      <TableCell data-testid={`text-qualification-level-${qual.id}`}>
                        {qual.level || "—"}
                      </TableCell>
                      <TableCell data-testid={`text-qualification-expiration-${qual.id}`}>
                        {qual.expirationDate || "—"}
                      </TableCell>
                      <TableCell data-testid={`text-qualification-active-${qual.id}`}>
                        <Badge variant={qual.isActive ? "default" : "secondary"}>
                          {qual.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function PlaceholderTab({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="h-5 w-5" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

export default function HRPage() {
  const [activeTab, handleTabChange] = useTabParam("reviews");

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-2 flex-wrap">
        <ClipboardList className="h-6 w-6" />
        <h1 className="text-2xl font-bold" data-testid="text-hr-title">HR</h1>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="flex-wrap" data-testid="tabs-hr">
          <TabsTrigger value="reviews" data-testid="tab-reviews">Reviews</TabsTrigger>
          <TabsTrigger value="kpi-groups" data-testid="tab-kpi-groups">KPI Groups</TabsTrigger>
          <TabsTrigger value="qualifications" data-testid="tab-qualifications">Qualifications</TabsTrigger>
          <TabsTrigger value="qualification-groups" data-testid="tab-qualification-groups">Qualification Groups</TabsTrigger>
          <TabsTrigger value="skills" data-testid="tab-skills">Skills</TabsTrigger>
          <TabsTrigger value="education" data-testid="tab-education">Education</TabsTrigger>
          <TabsTrigger value="memberships" data-testid="tab-memberships">Memberships</TabsTrigger>
          <TabsTrigger value="licenses" data-testid="tab-licenses">Licenses</TabsTrigger>
          <TabsTrigger value="languages" data-testid="tab-languages">Languages</TabsTrigger>
        </TabsList>

        <TabsContent value="reviews">
          <ReviewsTab />
        </TabsContent>

        <TabsContent value="kpi-groups">
          <PlaceholderTab
            icon={TrendingUp}
            title="KPI Groups"
            description="Key Performance Indicator group configuration."
          />
        </TabsContent>

        <TabsContent value="qualifications">
          <QualificationsTab />
        </TabsContent>

        <TabsContent value="qualification-groups">
          <PlaceholderTab
            icon={Award}
            title="Qualification Groups"
            description="Organize qualifications into groups for easier management."
          />
        </TabsContent>

        <TabsContent value="skills">
          <PlaceholderTab
            icon={Zap}
            title="Skills"
            description="Track employee skills and competencies."
          />
        </TabsContent>

        <TabsContent value="education">
          <PlaceholderTab
            icon={GraduationCap}
            title="Education"
            description="Education history and records."
          />
        </TabsContent>

        <TabsContent value="memberships">
          <PlaceholderTab
            icon={IdCard}
            title="Memberships"
            description="Professional membership tracking."
          />
        </TabsContent>

        <TabsContent value="licenses">
          <PlaceholderTab
            icon={BadgeCheck}
            title="Licenses"
            description="License and certification tracking with expiration alerts."
          />
        </TabsContent>

        <TabsContent value="languages">
          <PlaceholderTab
            icon={Languages}
            title="Languages"
            description="Language proficiency tracking."
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
