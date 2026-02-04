from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware  
 
from .db import Base, engine
from app.routers.auth import router as auth_router
from app.routers.organizations import router as organizations_router
from app.routers.venues import router as venues_router
from app.routers.events import router as events_router
from app.routers.portal import router as portal_router
from app import models

Base.metadata.create_all(bind=engine)

app = FastAPI(title="SeatFlow API")

app.add_middleware(
  CORSMiddleware,
  allow_origins=["http://localhost:5173", "http://localhost:3000"],
  allow_credentials=True,
  allow_methods=["*"],
  allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(organizations_router)
app.include_router(venues_router)
app.include_router(events_router)
app.include_router(portal_router)  

