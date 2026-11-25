from app.schemas.common import ORM, BaseModel, EmailStr, Field, OrgRole, Str, UserBrief, date, datetime


class OrgCreate(BaseModel):
    name: Str = Field(min_length=2, max_length=120)


class OrgUpdate(BaseModel):
    name: Str | None = Field(default=None, min_length=2, max_length=120)
    timezone: Str | None = Field(default=None, max_length=64)
    workdays: str | None = Field(default=None, pattern=r"^[1-7](,[1-7]){0,6}$")
    wip_limit: int | None = Field(default=None, ge=1, le=20)


class OrgOut(ORM):
    id: int
    name: str
    slug: str
    plan: str
    timezone: str = "America/Bogota"
    workdays: str = "1,2,3,4,5"
    wip_limit: int = 4
    created_at: datetime
    my_role: str | None = None


class MemberOut(BaseModel):
    user: UserBrief
    role: str
    title: str
    joined_at: datetime


class MemberUpdate(BaseModel):
    role: OrgRole | None = None
    title: Str | None = Field(default=None, max_length=80)


class InvitationCreate(BaseModel):
    email: EmailStr
    role: OrgRole = "member"


class InvitationOut(ORM):
    id: int
    email: EmailStr
    role: str
    created_at: datetime
    expires_at: datetime
    accepted_at: datetime | None


class InvitationCreated(InvitationOut):
    # Sólo se devuelve en desarrollo, para facilitar las pruebas sin correo real.
    invite_url: str | None = None


class TeamIn(BaseModel):
    name: Str = Field(min_length=2, max_length=80)
    description: Str = Field(default="", max_length=255)
    member_ids: list[int] = []
    lead_id: int | None = None
    is_qa: bool = False
    color: str = Field(default="#4F46E5", pattern=r"^#[0-9A-Fa-f]{6}$")


class TeamUpdate(BaseModel):
    name: Str | None = Field(default=None, min_length=2, max_length=80)
    description: Str | None = Field(default=None, max_length=255)
    member_ids: list[int] | None = None
    lead_id: int | None = None
    is_qa: bool | None = None
    color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")


class TeamOut(BaseModel):
    id: int
    name: str
    description: str
    color: str = "#4F46E5"
    is_qa: bool = False
    lead: UserBrief | None = None
    members: list[UserBrief]


class HolidayIn(BaseModel):
    date: date
    name: Str = Field(default="", max_length=120)


class HolidayOut(BaseModel):
    id: int
    date: date
    name: str


class AbsenceIn(BaseModel):
    user_id: int
    start_date: date
    end_date: date
    reason: Str = Field(default="", max_length=255)


class AbsenceOut(BaseModel):
    id: int
    user: UserBrief
    start_date: date
    end_date: date
    reason: str
