import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Company, Worker, Review, Qualification, KpiGroup, QualificationGroup, WorkerLanguage, WorkerMembership } from "@shared/schema";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
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
  Trash2,
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

function LoadingSkeleton({ testId }: { testId: string }) {
  return (
    <div className="space-y-3" data-testid={testId}>
      {[1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-12 w-full" />
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

  const deleteReview = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/reviews/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/reviews"] });
      toast({ title: "Review deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Error deleting review", description: error.message, variant: "destructive" });
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

  if (reviewsLoading) return <LoadingSkeleton testId="reviews-loading" />;

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
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(reviews || []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
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
                        {review.notes || "\u2014"}
                      </TableCell>
                      <TableCell>
                        <Button size="icon" variant="ghost" onClick={() => deleteReview.mutate(review.id)} data-testid={`button-delete-review-${review.id}`}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
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

  const deleteQualification = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/qualifications/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/qualifications"] });
      toast({ title: "Qualification deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Error deleting qualification", description: error.message, variant: "destructive" });
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

  if (isLoading) return <LoadingSkeleton testId="qualifications-loading" />;

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
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(qualifications || []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    No qualifications found
                  </TableCell>
                </TableRow>
              ) : (
                (qualifications || []).map((qual) => {
                  const worker = qual.workerId ? workerMap.get(qual.workerId) : null;
                  return (
                    <TableRow key={qual.id} data-testid={`row-qualification-${qual.id}`}>
                      <TableCell data-testid={`text-qualification-employee-${qual.id}`}>
                        {worker ? `${worker.firstName} ${worker.lastName}` : qual.workerId || "\u2014"}
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
                        {qual.level || "\u2014"}
                      </TableCell>
                      <TableCell data-testid={`text-qualification-expiration-${qual.id}`}>
                        {qual.expirationDate || "\u2014"}
                      </TableCell>
                      <TableCell data-testid={`text-qualification-active-${qual.id}`}>
                        <Badge variant={qual.isActive ? "default" : "secondary"}>
                          {qual.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button size="icon" variant="ghost" onClick={() => deleteQualification.mutate(qual.id)} data-testid={`button-delete-qualification-${qual.id}`}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
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

function SkillsTab() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [companyId, setCompanyId] = useState("");
  const [workerId, setWorkerId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [level, setLevel] = useState("");

  const { data: qualifications, isLoading } = useQuery<Qualification[]>({
    queryKey: ["/api/qualifications"],
  });

  const { data: workers } = useQuery<Worker[]>({ queryKey: ["/api/workers"] });
  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });

  const skills = (qualifications || []).filter((q) => q.type === "skill");
  const workerMap = new Map((workers || []).map((w) => [w.id, w]));

  const createSkill = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/qualifications", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/qualifications"] });
      setOpen(false);
      setCompanyId(""); setWorkerId(""); setName(""); setDescription(""); setLevel("");
      toast({ title: "Skill added successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error adding skill", description: error.message, variant: "destructive" });
    },
  });

  const deleteSkill = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/qualifications/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/qualifications"] });
      toast({ title: "Skill deleted" });
    },
  });

  if (isLoading) return <LoadingSkeleton testId="skills-loading" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-lg font-semibold">Skills</h3>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-skill"><Plus className="h-4 w-4 mr-2" />Add Skill</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Skill</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Company</Label>
                <Select value={companyId} onValueChange={setCompanyId}>
                  <SelectTrigger data-testid="select-skill-company"><SelectValue placeholder="Select company" /></SelectTrigger>
                  <SelectContent>{(companies || []).map((c) => (<SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>))}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Employee</Label>
                <Select value={workerId} onValueChange={setWorkerId}>
                  <SelectTrigger data-testid="select-skill-worker"><SelectValue placeholder="Select employee" /></SelectTrigger>
                  <SelectContent>{(workers || []).map((w) => (<SelectItem key={w.id} value={w.id}>{w.firstName} {w.lastName}</SelectItem>))}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Skill Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. JavaScript, Welding" data-testid="input-skill-name" />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" data-testid="input-skill-description" />
              </div>
              <div className="space-y-2">
                <Label>Level</Label>
                <Select value={level} onValueChange={setLevel}>
                  <SelectTrigger data-testid="select-skill-level"><SelectValue placeholder="Select level" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="beginner">Beginner</SelectItem>
                    <SelectItem value="intermediate">Intermediate</SelectItem>
                    <SelectItem value="advanced">Advanced</SelectItem>
                    <SelectItem value="expert">Expert</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={() => createSkill.mutate({ companyId, workerId: workerId || null, type: "skill", name, description: description || null, level: level || null })} disabled={createSkill.isPending} className="w-full" data-testid="button-submit-skill">
                {createSkill.isPending ? "Adding..." : "Add Skill"}
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
                <TableHead>Skill</TableHead>
                <TableHead>Level</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {skills.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No skills found</TableCell></TableRow>
              ) : (
                skills.map((skill) => {
                  const worker = skill.workerId ? workerMap.get(skill.workerId) : null;
                  return (
                    <TableRow key={skill.id} data-testid={`row-skill-${skill.id}`}>
                      <TableCell data-testid={`text-skill-employee-${skill.id}`}>{worker ? `${worker.firstName} ${worker.lastName}` : "\u2014"}</TableCell>
                      <TableCell data-testid={`text-skill-name-${skill.id}`}>{skill.name}</TableCell>
                      <TableCell data-testid={`text-skill-level-${skill.id}`}>{skill.level || "\u2014"}</TableCell>
                      <TableCell><Badge variant={skill.isActive ? "default" : "secondary"}>{skill.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                      <TableCell><Button size="icon" variant="ghost" onClick={() => deleteSkill.mutate(skill.id)} data-testid={`button-delete-skill-${skill.id}`}><Trash2 className="h-4 w-4" /></Button></TableCell>
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

function EducationTab() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [companyId, setCompanyId] = useState("");
  const [workerId, setWorkerId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [level, setLevel] = useState("");

  const { data: qualifications, isLoading } = useQuery<Qualification[]>({ queryKey: ["/api/qualifications"] });
  const { data: workers } = useQuery<Worker[]>({ queryKey: ["/api/workers"] });
  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });

  const education = (qualifications || []).filter((q) => q.type === "education");
  const workerMap = new Map((workers || []).map((w) => [w.id, w]));

  const createEducation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/qualifications", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/qualifications"] });
      setOpen(false);
      setCompanyId(""); setWorkerId(""); setName(""); setDescription(""); setLevel("");
      toast({ title: "Education record added" });
    },
    onError: (error: Error) => {
      toast({ title: "Error adding education", description: error.message, variant: "destructive" });
    },
  });

  const deleteEducation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/qualifications/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/qualifications"] });
      toast({ title: "Education record deleted" });
    },
  });

  if (isLoading) return <LoadingSkeleton testId="education-loading" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-lg font-semibold">Education</h3>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-education"><Plus className="h-4 w-4 mr-2" />Add Education</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Education Record</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Company</Label>
                <Select value={companyId} onValueChange={setCompanyId}>
                  <SelectTrigger data-testid="select-education-company"><SelectValue placeholder="Select company" /></SelectTrigger>
                  <SelectContent>{(companies || []).map((c) => (<SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>))}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Employee</Label>
                <Select value={workerId} onValueChange={setWorkerId}>
                  <SelectTrigger data-testid="select-education-worker"><SelectValue placeholder="Select employee" /></SelectTrigger>
                  <SelectContent>{(workers || []).map((w) => (<SelectItem key={w.id} value={w.id}>{w.firstName} {w.lastName}</SelectItem>))}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Institution / Degree</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. BS Computer Science, MIT" data-testid="input-education-name" />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Details" data-testid="input-education-description" />
              </div>
              <div className="space-y-2">
                <Label>Level</Label>
                <Select value={level} onValueChange={setLevel}>
                  <SelectTrigger data-testid="select-education-level"><SelectValue placeholder="Select level" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="high_school">High School</SelectItem>
                    <SelectItem value="associate">Associate</SelectItem>
                    <SelectItem value="bachelor">Bachelor</SelectItem>
                    <SelectItem value="master">Master</SelectItem>
                    <SelectItem value="doctorate">Doctorate</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={() => createEducation.mutate({ companyId, workerId: workerId || null, type: "education", name, description: description || null, level: level || null })} disabled={createEducation.isPending} className="w-full" data-testid="button-submit-education">
                {createEducation.isPending ? "Adding..." : "Add Education"}
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
                <TableHead>Institution / Degree</TableHead>
                <TableHead>Level</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {education.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No education records found</TableCell></TableRow>
              ) : (
                education.map((edu) => {
                  const worker = edu.workerId ? workerMap.get(edu.workerId) : null;
                  return (
                    <TableRow key={edu.id} data-testid={`row-education-${edu.id}`}>
                      <TableCell data-testid={`text-education-employee-${edu.id}`}>{worker ? `${worker.firstName} ${worker.lastName}` : "\u2014"}</TableCell>
                      <TableCell data-testid={`text-education-name-${edu.id}`}>{edu.name}</TableCell>
                      <TableCell data-testid={`text-education-level-${edu.id}`}>{edu.level || "\u2014"}</TableCell>
                      <TableCell><Badge variant={edu.isActive ? "default" : "secondary"}>{edu.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                      <TableCell><Button size="icon" variant="ghost" onClick={() => deleteEducation.mutate(edu.id)} data-testid={`button-delete-education-${edu.id}`}><Trash2 className="h-4 w-4" /></Button></TableCell>
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

function LicensesTab() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [companyId, setCompanyId] = useState("");
  const [workerId, setWorkerId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [expirationDate, setExpirationDate] = useState("");

  const { data: qualifications, isLoading } = useQuery<Qualification[]>({ queryKey: ["/api/qualifications"] });
  const { data: workers } = useQuery<Worker[]>({ queryKey: ["/api/workers"] });
  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });

  const licenses = (qualifications || []).filter((q) => q.type === "license" || q.type === "certification");
  const workerMap = new Map((workers || []).map((w) => [w.id, w]));

  const createLicense = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/qualifications", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/qualifications"] });
      setOpen(false);
      setCompanyId(""); setWorkerId(""); setName(""); setDescription(""); setExpirationDate("");
      toast({ title: "License added successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error adding license", description: error.message, variant: "destructive" });
    },
  });

  const deleteLicense = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/qualifications/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/qualifications"] });
      toast({ title: "License deleted" });
    },
  });

  if (isLoading) return <LoadingSkeleton testId="licenses-loading" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-lg font-semibold">Licenses &amp; Certifications</h3>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-license"><Plus className="h-4 w-4 mr-2" />Add License</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add License / Certification</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Company</Label>
                <Select value={companyId} onValueChange={setCompanyId}>
                  <SelectTrigger data-testid="select-license-company"><SelectValue placeholder="Select company" /></SelectTrigger>
                  <SelectContent>{(companies || []).map((c) => (<SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>))}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Employee</Label>
                <Select value={workerId} onValueChange={setWorkerId}>
                  <SelectTrigger data-testid="select-license-worker"><SelectValue placeholder="Select employee" /></SelectTrigger>
                  <SelectContent>{(workers || []).map((w) => (<SelectItem key={w.id} value={w.id}>{w.firstName} {w.lastName}</SelectItem>))}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>License Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. CPA, CDL Class A" data-testid="input-license-name" />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Details" data-testid="input-license-description" />
              </div>
              <div className="space-y-2">
                <Label>Expiration Date</Label>
                <Input type="date" value={expirationDate} onChange={(e) => setExpirationDate(e.target.value)} data-testid="input-license-expiration" />
              </div>
              <Button onClick={() => createLicense.mutate({ companyId, workerId: workerId || null, type: "license", name, description: description || null, expirationDate: expirationDate || null })} disabled={createLicense.isPending} className="w-full" data-testid="button-submit-license">
                {createLicense.isPending ? "Adding..." : "Add License"}
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
                <TableHead>License</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Expiration</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {licenses.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No licenses found</TableCell></TableRow>
              ) : (
                licenses.map((lic) => {
                  const worker = lic.workerId ? workerMap.get(lic.workerId) : null;
                  return (
                    <TableRow key={lic.id} data-testid={`row-license-${lic.id}`}>
                      <TableCell data-testid={`text-license-employee-${lic.id}`}>{worker ? `${worker.firstName} ${worker.lastName}` : "\u2014"}</TableCell>
                      <TableCell data-testid={`text-license-name-${lic.id}`}>{lic.name}</TableCell>
                      <TableCell><Badge variant="secondary">{lic.type}</Badge></TableCell>
                      <TableCell data-testid={`text-license-expiration-${lic.id}`}>{lic.expirationDate || "\u2014"}</TableCell>
                      <TableCell><Badge variant={lic.isActive ? "default" : "secondary"}>{lic.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                      <TableCell><Button size="icon" variant="ghost" onClick={() => deleteLicense.mutate(lic.id)} data-testid={`button-delete-license-${lic.id}`}><Trash2 className="h-4 w-4" /></Button></TableCell>
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

function KpiGroupsTab() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [companyId, setCompanyId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const { data: kpiGroups, isLoading } = useQuery<KpiGroup[]>({ queryKey: ["/api/kpi-groups"] });
  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });

  const createKpiGroup = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/kpi-groups", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/kpi-groups"] });
      setOpen(false);
      setCompanyId(""); setName(""); setDescription("");
      toast({ title: "KPI group created" });
    },
    onError: (error: Error) => {
      toast({ title: "Error creating KPI group", description: error.message, variant: "destructive" });
    },
  });

  const deleteKpiGroup = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/kpi-groups/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/kpi-groups"] });
      toast({ title: "KPI group deleted" });
    },
  });

  if (isLoading) return <LoadingSkeleton testId="kpi-groups-loading" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-lg font-semibold">KPI Groups</h3>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-kpi-group"><Plus className="h-4 w-4 mr-2" />Add KPI Group</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add KPI Group</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Company</Label>
                <Select value={companyId} onValueChange={setCompanyId}>
                  <SelectTrigger data-testid="select-kpi-company"><SelectValue placeholder="Select company" /></SelectTrigger>
                  <SelectContent>{(companies || []).map((c) => (<SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>))}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Group Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sales Performance" data-testid="input-kpi-name" />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" data-testid="input-kpi-description" />
              </div>
              <Button onClick={() => createKpiGroup.mutate({ companyId, name, description: description || null })} disabled={createKpiGroup.isPending} className="w-full" data-testid="button-submit-kpi-group">
                {createKpiGroup.isPending ? "Creating..." : "Create KPI Group"}
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
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(kpiGroups || []).length === 0 ? (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">No KPI groups found</TableCell></TableRow>
              ) : (
                (kpiGroups || []).map((g) => (
                  <TableRow key={g.id} data-testid={`row-kpi-group-${g.id}`}>
                    <TableCell data-testid={`text-kpi-name-${g.id}`}>{g.name}</TableCell>
                    <TableCell className="max-w-[300px] truncate" data-testid={`text-kpi-description-${g.id}`}>{g.description || "\u2014"}</TableCell>
                    <TableCell><Badge variant={g.isActive ? "default" : "secondary"}>{g.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                    <TableCell><Button size="icon" variant="ghost" onClick={() => deleteKpiGroup.mutate(g.id)} data-testid={`button-delete-kpi-group-${g.id}`}><Trash2 className="h-4 w-4" /></Button></TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function QualificationGroupsTab() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [companyId, setCompanyId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const { data: groups, isLoading } = useQuery<QualificationGroup[]>({ queryKey: ["/api/qualification-groups"] });
  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });

  const createGroup = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/qualification-groups", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/qualification-groups"] });
      setOpen(false);
      setCompanyId(""); setName(""); setDescription("");
      toast({ title: "Qualification group created" });
    },
    onError: (error: Error) => {
      toast({ title: "Error creating group", description: error.message, variant: "destructive" });
    },
  });

  const deleteGroup = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/qualification-groups/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/qualification-groups"] });
      toast({ title: "Qualification group deleted" });
    },
  });

  if (isLoading) return <LoadingSkeleton testId="qualification-groups-loading" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-lg font-semibold">Qualification Groups</h3>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-qualification-group"><Plus className="h-4 w-4 mr-2" />Add Group</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Qualification Group</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Company</Label>
                <Select value={companyId} onValueChange={setCompanyId}>
                  <SelectTrigger data-testid="select-qualgroup-company"><SelectValue placeholder="Select company" /></SelectTrigger>
                  <SelectContent>{(companies || []).map((c) => (<SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>))}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Group Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Technical Certifications" data-testid="input-qualgroup-name" />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" data-testid="input-qualgroup-description" />
              </div>
              <Button onClick={() => createGroup.mutate({ companyId, name, description: description || null })} disabled={createGroup.isPending} className="w-full" data-testid="button-submit-qualification-group">
                {createGroup.isPending ? "Creating..." : "Create Group"}
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
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(groups || []).length === 0 ? (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">No qualification groups found</TableCell></TableRow>
              ) : (
                (groups || []).map((g) => (
                  <TableRow key={g.id} data-testid={`row-qualgroup-${g.id}`}>
                    <TableCell data-testid={`text-qualgroup-name-${g.id}`}>{g.name}</TableCell>
                    <TableCell className="max-w-[300px] truncate" data-testid={`text-qualgroup-description-${g.id}`}>{g.description || "\u2014"}</TableCell>
                    <TableCell><Badge variant={g.isActive ? "default" : "secondary"}>{g.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                    <TableCell><Button size="icon" variant="ghost" onClick={() => deleteGroup.mutate(g.id)} data-testid={`button-delete-qualgroup-${g.id}`}><Trash2 className="h-4 w-4" /></Button></TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function LanguagesTab() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [companyId, setCompanyId] = useState("");
  const [workerId, setWorkerId] = useState("");
  const [language, setLanguage] = useState("");
  const [proficiency, setProficiency] = useState("basic");

  const { data: languages, isLoading } = useQuery<WorkerLanguage[]>({ queryKey: ["/api/worker-languages"] });
  const { data: workers } = useQuery<Worker[]>({ queryKey: ["/api/workers"] });
  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });

  const workerMap = new Map((workers || []).map((w) => [w.id, w]));

  const createLanguage = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/worker-languages", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/worker-languages"] });
      setOpen(false);
      setCompanyId(""); setWorkerId(""); setLanguage(""); setProficiency("basic");
      toast({ title: "Language added" });
    },
    onError: (error: Error) => {
      toast({ title: "Error adding language", description: error.message, variant: "destructive" });
    },
  });

  const deleteLanguage = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/worker-languages/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/worker-languages"] });
      toast({ title: "Language deleted" });
    },
  });

  if (isLoading) return <LoadingSkeleton testId="languages-loading" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-lg font-semibold">Languages</h3>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-language"><Plus className="h-4 w-4 mr-2" />Add Language</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Language</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Company</Label>
                <Select value={companyId} onValueChange={setCompanyId}>
                  <SelectTrigger data-testid="select-language-company"><SelectValue placeholder="Select company" /></SelectTrigger>
                  <SelectContent>{(companies || []).map((c) => (<SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>))}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Employee</Label>
                <Select value={workerId} onValueChange={setWorkerId}>
                  <SelectTrigger data-testid="select-language-worker"><SelectValue placeholder="Select employee" /></SelectTrigger>
                  <SelectContent>{(workers || []).map((w) => (<SelectItem key={w.id} value={w.id}>{w.firstName} {w.lastName}</SelectItem>))}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Language</Label>
                <Input value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="e.g. English, Spanish, Mandarin" data-testid="input-language-name" />
              </div>
              <div className="space-y-2">
                <Label>Proficiency</Label>
                <Select value={proficiency} onValueChange={setProficiency}>
                  <SelectTrigger data-testid="select-language-proficiency"><SelectValue placeholder="Select proficiency" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="basic">Basic</SelectItem>
                    <SelectItem value="conversational">Conversational</SelectItem>
                    <SelectItem value="professional">Professional</SelectItem>
                    <SelectItem value="fluent">Fluent</SelectItem>
                    <SelectItem value="native">Native</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={() => createLanguage.mutate({ companyId, workerId: workerId || null, language, proficiency })} disabled={createLanguage.isPending} className="w-full" data-testid="button-submit-language">
                {createLanguage.isPending ? "Adding..." : "Add Language"}
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
                <TableHead>Language</TableHead>
                <TableHead>Proficiency</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(languages || []).length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No languages found</TableCell></TableRow>
              ) : (
                (languages || []).map((lang) => {
                  const worker = lang.workerId ? workerMap.get(lang.workerId) : null;
                  return (
                    <TableRow key={lang.id} data-testid={`row-language-${lang.id}`}>
                      <TableCell data-testid={`text-language-employee-${lang.id}`}>{worker ? `${worker.firstName} ${worker.lastName}` : "\u2014"}</TableCell>
                      <TableCell data-testid={`text-language-name-${lang.id}`}>{lang.language}</TableCell>
                      <TableCell data-testid={`text-language-proficiency-${lang.id}`}><Badge variant="secondary">{lang.proficiency}</Badge></TableCell>
                      <TableCell><Badge variant={lang.isActive ? "default" : "secondary"}>{lang.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                      <TableCell><Button size="icon" variant="ghost" onClick={() => deleteLanguage.mutate(lang.id)} data-testid={`button-delete-language-${lang.id}`}><Trash2 className="h-4 w-4" /></Button></TableCell>
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

function MembershipsTab() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [companyId, setCompanyId] = useState("");
  const [workerId, setWorkerId] = useState("");
  const [organization, setOrganization] = useState("");
  const [membershipNumber, setMembershipNumber] = useState("");
  const [startDate, setStartDate] = useState("");
  const [expirationDate, setExpirationDate] = useState("");

  const { data: memberships, isLoading } = useQuery<WorkerMembership[]>({ queryKey: ["/api/worker-memberships"] });
  const { data: workers } = useQuery<Worker[]>({ queryKey: ["/api/workers"] });
  const { data: companies } = useQuery<Company[]>({ queryKey: ["/api/companies"] });

  const workerMap = new Map((workers || []).map((w) => [w.id, w]));

  const createMembership = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/worker-memberships", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/worker-memberships"] });
      setOpen(false);
      setCompanyId(""); setWorkerId(""); setOrganization(""); setMembershipNumber(""); setStartDate(""); setExpirationDate("");
      toast({ title: "Membership added" });
    },
    onError: (error: Error) => {
      toast({ title: "Error adding membership", description: error.message, variant: "destructive" });
    },
  });

  const deleteMembership = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/worker-memberships/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/worker-memberships"] });
      toast({ title: "Membership deleted" });
    },
  });

  if (isLoading) return <LoadingSkeleton testId="memberships-loading" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-lg font-semibold">Memberships</h3>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-membership"><Plus className="h-4 w-4 mr-2" />Add Membership</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Membership</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Company</Label>
                <Select value={companyId} onValueChange={setCompanyId}>
                  <SelectTrigger data-testid="select-membership-company"><SelectValue placeholder="Select company" /></SelectTrigger>
                  <SelectContent>{(companies || []).map((c) => (<SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>))}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Employee</Label>
                <Select value={workerId} onValueChange={setWorkerId}>
                  <SelectTrigger data-testid="select-membership-worker"><SelectValue placeholder="Select employee" /></SelectTrigger>
                  <SelectContent>{(workers || []).map((w) => (<SelectItem key={w.id} value={w.id}>{w.firstName} {w.lastName}</SelectItem>))}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Organization</Label>
                <Input value={organization} onChange={(e) => setOrganization(e.target.value)} placeholder="e.g. AMA, IEEE" data-testid="input-membership-organization" />
              </div>
              <div className="space-y-2">
                <Label>Membership Number</Label>
                <Input value={membershipNumber} onChange={(e) => setMembershipNumber(e.target.value)} placeholder="Optional" data-testid="input-membership-number" />
              </div>
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} data-testid="input-membership-start" />
              </div>
              <div className="space-y-2">
                <Label>Expiration Date</Label>
                <Input type="date" value={expirationDate} onChange={(e) => setExpirationDate(e.target.value)} data-testid="input-membership-expiration" />
              </div>
              <Button onClick={() => createMembership.mutate({ companyId, workerId: workerId || null, organization, membershipNumber: membershipNumber || null, startDate: startDate || null, expirationDate: expirationDate || null })} disabled={createMembership.isPending} className="w-full" data-testid="button-submit-membership">
                {createMembership.isPending ? "Adding..." : "Add Membership"}
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
                <TableHead>Organization</TableHead>
                <TableHead>Member #</TableHead>
                <TableHead>Start</TableHead>
                <TableHead>Expiration</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(memberships || []).length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No memberships found</TableCell></TableRow>
              ) : (
                (memberships || []).map((m) => {
                  const worker = m.workerId ? workerMap.get(m.workerId) : null;
                  return (
                    <TableRow key={m.id} data-testid={`row-membership-${m.id}`}>
                      <TableCell data-testid={`text-membership-employee-${m.id}`}>{worker ? `${worker.firstName} ${worker.lastName}` : "\u2014"}</TableCell>
                      <TableCell data-testid={`text-membership-org-${m.id}`}>{m.organization}</TableCell>
                      <TableCell data-testid={`text-membership-number-${m.id}`}>{m.membershipNumber || "\u2014"}</TableCell>
                      <TableCell data-testid={`text-membership-start-${m.id}`}>{m.startDate || "\u2014"}</TableCell>
                      <TableCell data-testid={`text-membership-expiration-${m.id}`}>{m.expirationDate || "\u2014"}</TableCell>
                      <TableCell><Badge variant={m.isActive ? "default" : "secondary"}>{m.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                      <TableCell><Button size="icon" variant="ghost" onClick={() => deleteMembership.mutate(m.id)} data-testid={`button-delete-membership-${m.id}`}><Trash2 className="h-4 w-4" /></Button></TableCell>
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

export default function HRPage() {
  const [activeTab, handleTabChange] = useTabParam("reviews");

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-2 flex-wrap">
        <ClipboardList className="h-6 w-6 text-blue-accent" />
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
          <KpiGroupsTab />
        </TabsContent>

        <TabsContent value="qualifications">
          <QualificationsTab />
        </TabsContent>

        <TabsContent value="qualification-groups">
          <QualificationGroupsTab />
        </TabsContent>

        <TabsContent value="skills">
          <SkillsTab />
        </TabsContent>

        <TabsContent value="education">
          <EducationTab />
        </TabsContent>

        <TabsContent value="memberships">
          <MembershipsTab />
        </TabsContent>

        <TabsContent value="licenses">
          <LicensesTab />
        </TabsContent>

        <TabsContent value="languages">
          <LanguagesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
