from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    DATABASE_URL: str
    JWT_SECRET: str
    # Java seating solver. Set to "" to always use the built-in Python heuristic.
    SOLVER_URL: str = "http://localhost:8081"
    SOLVER_RUNS: int = 100

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

settings = Settings()
