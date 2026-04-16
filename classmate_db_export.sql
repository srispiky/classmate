--
-- PostgreSQL database dump
--


-- Dumped from database version 16.10
-- Dumped by pg_dump version 16.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: activity; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activity (
    id integer NOT NULL,
    type text NOT NULL,
    description text NOT NULL,
    student_name text NOT NULL,
    course_name text NOT NULL,
    "timestamp" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: activity_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.activity_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: activity_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.activity_id_seq OWNED BY public.activity.id;


--
-- Name: assessments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assessments (
    id integer NOT NULL,
    student_id integer NOT NULL,
    course_id integer NOT NULL,
    title text NOT NULL,
    score real NOT NULL,
    max_score real DEFAULT 100 NOT NULL,
    strengths json DEFAULT '[]'::json NOT NULL,
    weaknesses json DEFAULT '[]'::json NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: assessments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.assessments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: assessments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.assessments_id_seq OWNED BY public.assessments.id;


--
-- Name: assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assignments (
    id integer NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    course_id integer NOT NULL,
    student_id integer NOT NULL,
    due_date text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    score real,
    max_score real DEFAULT 100 NOT NULL,
    feedback text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: assignments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.assignments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: assignments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.assignments_id_seq OWNED BY public.assignments.id;


--
-- Name: courses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.courses (
    id integer NOT NULL,
    name text NOT NULL,
    description text NOT NULL,
    teacher_name text NOT NULL,
    subject text NOT NULL,
    student_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: courses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.courses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: courses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.courses_id_seq OWNED BY public.courses.id;


--
-- Name: notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notes (
    id integer NOT NULL,
    title text NOT NULL,
    content text NOT NULL,
    course_id integer NOT NULL,
    topic text NOT NULL,
    video_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: notes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.notes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notes_id_seq OWNED BY public.notes.id;


--
-- Name: students; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.students (
    id integer NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    grade text NOT NULL,
    avatar_url text,
    enrolled_course_ids json DEFAULT '[]'::json NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: students_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.students_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: students_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.students_id_seq OWNED BY public.students.id;


--
-- Name: activity id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity ALTER COLUMN id SET DEFAULT nextval('public.activity_id_seq'::regclass);


--
-- Name: assessments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessments ALTER COLUMN id SET DEFAULT nextval('public.assessments_id_seq'::regclass);


--
-- Name: assignments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assignments ALTER COLUMN id SET DEFAULT nextval('public.assignments_id_seq'::regclass);


--
-- Name: courses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.courses ALTER COLUMN id SET DEFAULT nextval('public.courses_id_seq'::regclass);


--
-- Name: notes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notes ALTER COLUMN id SET DEFAULT nextval('public.notes_id_seq'::regclass);


--
-- Name: students id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students ALTER COLUMN id SET DEFAULT nextval('public.students_id_seq'::regclass);


--
-- Data for Name: activity; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.activity (id, type, description, student_name, course_name, "timestamp") FROM stdin;
1	assignment_graded	Assignment "Algebra Problem Set 1" graded with score 88/100	Alice Johnson	Mathematics 101	2026-04-16 17:26:29.991611+00
2	assessment_completed	Assessment "Mid-term Math Test" completed with score 82/100	Alice Johnson	Mathematics 101	2026-04-16 17:26:29.991611+00
3	assignment_graded	Assignment "Algebra Problem Set 1" graded with score 92/100	Marcus Williams	Mathematics 101	2026-04-16 17:26:29.991611+00
4	note_created	Lesson note "Quadratic Equations" added for topic "Polynomials"	Teacher	Mathematics 101	2026-04-16 17:26:29.991611+00
5	assignment_graded	Assignment "Cell Biology Quiz" submitted	Marcus Williams	Biology	2026-04-16 17:26:29.991611+00
6	assessment_completed	Assessment "Literature Quiz 1" completed with score 74/100	Alice Johnson	English Literature	2026-04-16 17:26:29.991611+00
\.


--
-- Data for Name: assessments; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.assessments (id, student_id, course_id, title, score, max_score, strengths, weaknesses, created_at) FROM stdin;
1	1	1	Mid-term Math Test	82	100	["Linear equations", "Basic algebra", "Number theory"]	["Quadratic equations", "Graphing functions"]	2026-04-16 17:26:29.991611+00
2	1	2	Literature Quiz 1	74	100	["Character analysis", "Theme identification"]	["Citation format", "Close reading"]	2026-04-16 17:26:29.991611+00
3	2	1	Mid-term Math Test	95	100	["All algebra topics", "Problem solving", "Calculus basics"]	["Speed under pressure"]	2026-04-16 17:26:29.991611+00
4	3	1	Mid-term Math Test	65	100	["Basic arithmetic", "Word problems"]	["Quadratic equations", "Graphing", "Trigonometry"]	2026-04-16 17:26:29.991611+00
5	4	2	Literature Quiz 1	89	100	["Critical thinking", "Essay structure", "Vocabulary"]	["Historical context"]	2026-04-16 17:26:29.991611+00
6	5	3	Biology Midterm	91	100	["Cell biology", "Genetics", "Ecosystem dynamics"]	["Biochemistry formulas"]	2026-04-16 17:26:29.991611+00
\.


--
-- Data for Name: assignments; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.assignments (id, title, description, course_id, student_id, due_date, status, score, max_score, feedback, created_at) FROM stdin;
1	Algebra Problem Set 1	Solve 20 linear equations showing all working	1	1	2026-04-10	graded	88	100	Excellent work on the first 15 problems. Review your negative number arithmetic.	2026-04-16 17:26:29.991611+00
2	Hamlet Essay	Write a 1000-word analysis of Hamlet's soliloquy in Act 3	2	1	2026-04-12	graded	76	100	Good thesis but needs more textual evidence. Work on citations.	2026-04-16 17:26:29.991611+00
3	Cell Biology Quiz	Quiz covering organelles and cell functions	3	1	2026-04-15	pending	\N	50	\N	2026-04-16 17:26:29.991611+00
4	Algebra Problem Set 1	Solve 20 linear equations showing all working	1	2	2026-04-10	graded	92	100	Outstanding! Perfect algebra techniques.	2026-04-16 17:26:29.991611+00
5	Cell Biology Quiz	Quiz covering organelles and cell functions	3	2	2026-04-15	submitted	\N	50	\N	2026-04-16 17:26:29.991611+00
6	World History Essay	Analyze causes of the French Revolution	4	2	2026-04-20	pending	\N	100	\N	2026-04-16 17:26:29.991611+00
7	Algebra Problem Set 1	Solve 20 linear equations showing all working	1	3	2026-04-10	graded	71	100	Needs improvement on quadratic section. Review the notes.	2026-04-16 17:26:29.991611+00
8	Hamlet Essay	Write a 1000-word analysis of Hamlet's soliloquy in Act 3	2	3	2026-04-12	late	\N	100	\N	2026-04-16 17:26:29.991611+00
9	Algebra Problem Set 1	Solve 20 linear equations showing all working	1	4	2026-04-10	graded	85	100	Good work overall. Minor errors in substitution section.	2026-04-16 17:26:29.991611+00
10	Cell Biology Quiz	Quiz covering organelles and cell functions	3	5	2026-04-15	graded	45	50	Great job! Near perfect score.	2026-04-16 17:26:29.991611+00
\.


--
-- Data for Name: courses; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.courses (id, name, description, teacher_name, subject, student_count, created_at) FROM stdin;
1	Mathematics 101	Fundamentals of algebra, geometry, and calculus	Dr. Sarah Mitchell	Mathematics	18	2026-04-16 17:26:29.991611+00
2	English Literature	Analysis of classic and modern literary works	Mr. James Harwood	English	22	2026-04-16 17:26:29.991611+00
3	Biology	Life sciences from cell biology to ecosystems	Dr. Priya Nair	Science	20	2026-04-16 17:26:29.991611+00
4	World History	From ancient civilizations to the modern era	Ms. Elena Torres	History	25	2026-04-16 17:26:29.991611+00
\.


--
-- Data for Name: notes; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.notes (id, title, content, course_id, topic, video_url, created_at) FROM stdin;
1	Introduction to Algebra	Algebra is the branch of mathematics dealing with symbols and the rules for manipulating those symbols. Key concepts include variables, expressions, equations, and functions. We start with linear equations: ax + b = c.	1	Algebra Basics	\N	2026-04-16 17:26:29.991611+00
2	Quadratic Equations	A quadratic equation is a second-order polynomial equation in a single variable x: ax² + bx + c = 0. Solutions can be found using the quadratic formula, factoring, or completing the square.	1	Polynomials	https://www.youtube.com/watch?v=example1	2026-04-16 17:26:29.991611+00
3	Shakespeare: Hamlet	Hamlet explores themes of revenge, corruption, mortality, and moral integrity. Prince Hamlet's soliloquies reveal his internal conflict as he contemplates his father's murder and his duty to act.	2	Shakespeare	\N	2026-04-16 17:26:29.991611+00
4	Cell Structure and Function	Cells are the basic unit of life. Prokaryotic cells lack a nucleus, while eukaryotic cells have membrane-bound organelles. Key organelles: nucleus, mitochondria, ribosomes, endoplasmic reticulum.	3	Cell Biology	https://www.youtube.com/watch?v=example2	2026-04-16 17:26:29.991611+00
5	The French Revolution	The French Revolution (1789-1799) was a period of radical political and societal transformation in France. Causes included financial crisis, social inequality, and Enlightenment ideas. Key events: storming of the Bastille, Declaration of the Rights of Man.	4	Modern History	\N	2026-04-16 17:26:29.991611+00
\.


--
-- Data for Name: students; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.students (id, name, email, grade, avatar_url, enrolled_course_ids, created_at) FROM stdin;
1	Alice Johnson	alice.johnson@school.edu	10th Grade	\N	[1, 2, 3]	2026-04-16 17:26:29.991611+00
2	Marcus Williams	marcus.w@school.edu	10th Grade	\N	[1, 3, 4]	2026-04-16 17:26:29.991611+00
3	Sofia Garcia	sofia.garcia@school.edu	11th Grade	\N	[1, 2, 4]	2026-04-16 17:26:29.991611+00
4	Ethan Chen	ethan.chen@school.edu	10th Grade	\N	[2, 3, 4]	2026-04-16 17:26:29.991611+00
5	Amara Osei	amara.osei@school.edu	11th Grade	\N	[1, 2, 3, 4]	2026-04-16 17:26:29.991611+00
\.


--
-- Name: activity_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.activity_id_seq', 6, true);


--
-- Name: assessments_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.assessments_id_seq', 6, true);


--
-- Name: assignments_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.assignments_id_seq', 10, true);


--
-- Name: courses_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.courses_id_seq', 4, true);


--
-- Name: notes_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.notes_id_seq', 5, true);


--
-- Name: students_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.students_id_seq', 5, true);


--
-- Name: activity activity_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity
    ADD CONSTRAINT activity_pkey PRIMARY KEY (id);


--
-- Name: assessments assessments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assessments
    ADD CONSTRAINT assessments_pkey PRIMARY KEY (id);


--
-- Name: assignments assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assignments
    ADD CONSTRAINT assignments_pkey PRIMARY KEY (id);


--
-- Name: courses courses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.courses
    ADD CONSTRAINT courses_pkey PRIMARY KEY (id);


--
-- Name: notes notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notes
    ADD CONSTRAINT notes_pkey PRIMARY KEY (id);


--
-- Name: students students_email_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_email_unique UNIQUE (email);


--
-- Name: students students_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_pkey PRIMARY KEY (id);


--
-- PostgreSQL database dump complete
--

\unrestrict d8B4wKeUqbm5UPqRzHK94FOec9vpXEQdXfdJhQFCRUq3BOwjnqjplDYhVRef2uO

