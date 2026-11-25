from app.schemas.common import ORM, BaseModel, EmailStr, Field, Str, datetime


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: Str = Field(min_length=2, max_length=120)
    organization_name: Str | None = Field(default=None, max_length=120)
    invitation_token: str | None = None


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(max_length=128)


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


class TokenIn(BaseModel):
    token: str = Field(min_length=10, max_length=200)


class EmailIn(BaseModel):
    email: EmailStr


class ResetPasswordIn(BaseModel):
    token: str = Field(min_length=10, max_length=200)
    password: str = Field(min_length=8, max_length=128)


class OrgMembershipOut(BaseModel):
    organization_id: int
    name: str
    slug: str
    role: str


class MeOut(ORM):
    id: int
    email: EmailStr
    full_name: str
    avatar_color: str
    is_platform_admin: bool
    email_verified: bool
    created_at: datetime
    organizations: list[OrgMembershipOut]


class MeUpdate(BaseModel):
    full_name: Str | None = Field(default=None, min_length=2, max_length=120)
    avatar_color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    current_password: str | None = None
    new_password: str | None = Field(default=None, min_length=8, max_length=128)


class SessionOut(ORM):
    id: int
    user_agent: str
    ip_address: str
    created_at: datetime
    last_used_at: datetime
    current: bool = False


class InvitationPreview(BaseModel):
    organization_name: str
    email: EmailStr
    role: str
    expired: bool
    accepted: bool
    user_exists: bool
