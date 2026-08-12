package main

import (
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/gin-gonic/gin"
	"github.com/pcl/pcl-api/internal/config"
	"github.com/pcl/pcl-api/internal/database"
	"github.com/pcl/pcl-api/internal/handlers"
	"github.com/pcl/pcl-api/internal/middleware"
)

func main() {
	// Load configuration
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("Failed to load configuration: %v", err)
	}

	// Set Gin mode
	gin.SetMode(cfg.Server.Mode)

	// Initialize database
	if err := database.InitPostgres(&cfg.Database); err != nil {
		log.Fatalf("Failed to connect to PostgreSQL: %v", err)
	}
	defer database.Close()

	// Initialize Redis (optional - won't fail if unavailable)
	if err := database.InitRedis(&cfg.Redis); err != nil {
		log.Printf("Warning: Redis not available, caching disabled")
	}
	defer database.CloseRedis()

	// Initialize JWT
	middleware.InitJWT(&cfg.JWT)

	// Initialize email config for score card sending
	handlers.EmailConfig.Sender = cfg.Email.Sender
	handlers.EmailConfig.AppPassword = cfg.Email.AppPassword

	// Initialize gap analysis (TL response links and upload storage)
	handlers.InitGapHandlers(&cfg.Gap, cfg.JWT.Secret)
	handlers.InitGapStorage(cfg.Storage.UploadPath)

	// Initialize handlers
	handlers.InitReportHandlers(&cfg.Storage)
	handlers.InitProcedureHandlers(&cfg.Storage)
	handlers.InitMarketingHandlers()
	handlers.InitLocalTripHandlers()
	handlers.InitConsentIncentiveHandlers()

	// Create Gin router
	router := gin.New()

	// Add middlewares
	router.Use(middleware.RecoveryMiddleware())
	router.Use(middleware.LoggingMiddleware())
	router.Use(middleware.CORSMiddleware(&cfg.CORS))

	// Root redirect to health/docs
	router.GET("/", func(c *gin.Context) {
		c.JSON(200, gin.H{
			"service": "pcl-api",
			"status":  "running",
			"health":  "/health",
			"api":     "/api",
		})
	})

	// Health check endpoint
	router.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{
			"status":  "healthy",
			"service": "pcl-api",
		})
	})

	// API routes
	api := router.Group("/api")
	{
		// Public routes (no auth required)
		public := api.Group("")
		{
			public.POST("/auth/login", handlers.Login)
			public.POST("/auth/register", handlers.Register)
			// Team Leader submits Actual Sales Rep via token (no login)
			public.POST("/gap-analysis/actual-reps", handlers.PostGapActualRepWithToken)
			public.GET("/gap-analysis/verify-token", handlers.GetGapResponseTokenPayload)
		}

		// Protected routes (auth required)
		protected := api.Group("")
			protected.Use(middleware.AuthMiddleware())
		{
			// Email routes (score card report)
			protected.POST("/email/scorecard", handlers.SendScoreCardEmail)

			// Gap Analysis: fetch/save actual reps, upload Excel, get TL response link, Google Sheet URL
			protected.GET("/gap-analysis/reports/:reportId/actual-reps", handlers.GetGapActualRepsByReport)
			protected.POST("/gap-analysis/reports/:reportId/actual-reps", handlers.PostGapActualRepForReport)
			protected.POST("/gap-analysis/reports/:reportId/actual-reps/upload", handlers.PostGapActualRepsUpload)
			protected.GET("/gap-analysis/reports/:reportId/uploaded-file", handlers.GetGapUploadedFile)
			protected.DELETE("/gap-analysis/reports/:reportId/uploaded-file", handlers.DeleteGapUploadedFile)
			protected.GET("/gap-analysis/response-link", handlers.GetGapResponseLink)
			protected.GET("/gap-analysis/sheet-url", handlers.GetGapSheetURL)

			// Auth routes
			auth := protected.Group("/auth")
			{
				auth.GET("/me", handlers.GetCurrentUser)
				auth.PUT("/profile", handlers.UpdateProfile)
				auth.PUT("/password", handlers.ChangePassword)
				auth.POST("/refresh", handlers.RefreshToken)
				auth.POST("/logout", handlers.Logout)
			}

			// Reports routes
			reports := protected.Group("/reports")
			{
				reports.GET("", handlers.GetAllReports)
				reports.GET("/recent", handlers.GetRecentReports)
				reports.GET("/search", handlers.SearchReports)
				reports.GET("/batch-data", handlers.GetBatchReportData)
				reports.GET("/cluster-data", handlers.GetClusterData)
				reports.GET("/sheets", handlers.GetAvailableSheets)
				reports.GET("/regional-data", handlers.GetRegionalData)
				reports.GET("/regional-batch", handlers.GetRegionalDataBatch)
				reports.GET("/:id", handlers.GetReportByID)
				reports.GET("/:id/data", handlers.GetReportData)
				reports.GET("/:id/download", handlers.DownloadReport)
				reports.GET("/department/:department/type/:type", handlers.GetReportsByDepartmentAndType)
				reports.POST("", handlers.UploadReport)
				reports.PUT("/:id", handlers.UpdateReport)
				reports.DELETE("/:id", handlers.DeleteReport)
			}

			// Marketing Digital Sales routes
			marketing := protected.Group("/marketing/digital-sales")
			{
				marketing.POST("/upload", handlers.UploadMarketingDSFile)
				marketing.GET("/files", handlers.GetMarketingDSFiles)
				marketing.DELETE("/files/:year", handlers.DeleteMarketingDSFile)
				marketing.GET("/files/:year/download", handlers.DownloadMarketingDSFile)
			}

			// Settlements routes (auth-only; all analysts can upload/replace their Settlements inputs)
			settlements := protected.Group("/settlements")
			{
				settlements.POST("/upload", handlers.UploadSettlementFile)
				settlements.GET("/active", handlers.GetSettlementActive)
				settlements.GET("/versions", handlers.ListSettlementVersions)
				settlements.GET("/:fileId/download", handlers.DownloadSettlementFile)
				settlements.DELETE("/:fileId", handlers.DeleteSettlementFile)
			}

			// Local Trip Report routes
			localTrip := protected.Group("/local-trip")
			{
				localTrip.POST("/upload", handlers.UploadLocalTripFile)
				localTrip.GET("/files", handlers.GetLocalTripFiles)
				localTrip.GET("/files/:fileId/download", handlers.DownloadLocalTripFile)
				localTrip.DELETE("/files/:fileId", handlers.DeleteLocalTripFile)
			}

			// Consent Incentive Report routes
			consentIncentive := protected.Group("/consent-incentive")
			{
				consentIncentive.POST("/upload", handlers.UploadConsentIncentiveFile)
				consentIncentive.GET("/files", handlers.GetConsentIncentiveFiles)
				consentIncentive.GET("/files/:fileId/download", handlers.DownloadConsentIncentiveFile)
				consentIncentive.DELETE("/files/:fileId", handlers.DeleteConsentIncentiveFile)
			}

			// Social Media Analysis — reads call-centre Google Sheets via service account
			protected.GET("/social-media/data", handlers.GetSocialMediaData)
			protected.GET("/social-media/months", handlers.GetSocialMediaMonths)

			// DIGITAL DATA — cleaned lead warehouse + distribution
			digital := protected.Group("/digital-data")
			{
				digital.POST("/ingest", handlers.IngestDigitalData)
				digital.GET("/runs", handlers.GetDigitalIngestRuns)
				digital.GET("/summary", handlers.GetDigitalDataSummary)
				digital.GET("/quality", handlers.GetDigitalDataQuality)
				digital.GET("/leads", handlers.GetDigitalLeads)
				digital.GET("/filters", handlers.GetDigitalDataFilters)
				digital.POST("/directory/sync", handlers.SyncDigitalDirectory)
				digital.GET("/directory", handlers.GetDigitalDirectory)
				digital.POST("/distribute", handlers.DistributeDigitalLeads)
				digital.GET("/distributions", handlers.GetDigitalDistributions)
				digital.POST("/send-distribution", handlers.SendDigitalDistribution)
				digital.GET("/send-log", handlers.GetDigitalSendLog)
			}

			// CRM — accumulating lead store, distributed to branch Team Leaders
			crm := protected.Group("/crm")
			{
				crm.POST("/upload", handlers.UploadCRMLeads)
				crm.GET("/uploads", handlers.GetCRMUploads)
				crm.GET("/summary", handlers.GetCRMSummary)
				crm.GET("/leads", handlers.GetCRMLeads)
				crm.GET("/filters", handlers.GetCRMFilters)
				crm.GET("/team-leaders", handlers.GetCRMTeamLeaders)
				crm.POST("/distribute", handlers.DistributeCRMLeads)
				crm.GET("/distributions", handlers.GetCRMDistributions)
				crm.POST("/send", handlers.SendCRMDistribution)
				crm.GET("/send-log", handlers.GetCRMSendLog)
			}

			// LBF Call Centre monthly targets — reads the Performance Dashboard sheet
			protected.GET("/lbf-callcenter-targets", handlers.GetLBFCallCenterTargets)

			// KPI Targets routes (admin-only)
			kpiTargets := protected.Group("/kpi-targets")
			kpiTargets.Use(middleware.AdminMiddleware())
			{
				kpiTargets.POST("/upload", handlers.UploadKpiTargetFile)
				kpiTargets.GET("/versions", handlers.GetKpiTargetVersions)
				kpiTargets.GET("/active", handlers.GetKpiTargetActive)
				kpiTargets.GET("/:fileId/parsed", handlers.GetKpiTargetParsedByFileID)
				kpiTargets.POST("/:fileId/activate", handlers.ActivateKpiTargetVersion)
				kpiTargets.DELETE("/:fileId", handlers.DeleteKpiTargetVersion)
				kpiTargets.GET("/:fileId/download", handlers.DownloadKpiTargetFile)
			}

			// Dashboard routes
			dashboard := protected.Group("/dashboard")
			{
				dashboard.GET("", handlers.GetDashboardData)
				dashboard.GET("/stats", handlers.GetDashboardStats)
				dashboard.GET("/metrics", handlers.GetAvailableMetrics)
				dashboard.GET("/dates", handlers.GetAvailableDates)
			}

			// Challenges routes
			challenges := protected.Group("/challenges")
			{
				challenges.GET("", handlers.GetAllChallenges)
				challenges.GET("/search", handlers.SearchChallenges)
				challenges.GET("/:id", handlers.GetChallengeByID)
				challenges.GET("/department/:department", handlers.GetChallengesByDepartment)
				challenges.POST("", handlers.CreateChallenge)
				challenges.PUT("/:id", handlers.UpdateChallenge)
				challenges.DELETE("/:id", handlers.DeleteChallenge)
				challenges.POST("/:id/image", handlers.UploadChallengeImage)
				challenges.POST("/:id/attachment", handlers.UploadChallengeAttachment)
			}

			// Procedures routes
			procedures := protected.Group("/procedures")
			{
				procedures.GET("", handlers.GetAllProcedures)
				procedures.GET("/type/:type", handlers.GetProcedureByTypeAndDepartment)
				procedures.POST("", handlers.CreateProcedure)
				procedures.PUT("/:id", handlers.UpdateProcedure)
				procedures.DELETE("/:id", handlers.DeleteProcedure)
				procedures.POST("/upload", handlers.UploadProcedureFile)
				procedures.GET("/files/*path", handlers.DownloadProcedureFile)
			}

			// Admin routes (admin only)
			admin := protected.Group("/admin")
			admin.Use(middleware.AdminMiddleware())
			{
				// User management
				users := admin.Group("/users")
				{
					users.GET("", handlers.GetAllUsers)
					users.GET("/search", handlers.SearchUsers)
					users.GET("/:id", handlers.GetUserByID)
					users.POST("", handlers.CreateUser)
					users.PUT("/:id", handlers.UpdateUser)
					users.DELETE("/:id", handlers.DeleteUser)
					users.PUT("/:id/password", handlers.ResetUserPassword)
					users.PUT("/:id/toggle-status", handlers.ToggleUserStatus)
				}

				// Dashboard management
				admin.POST("/refresh-views", handlers.RefreshMaterializedView)
				admin.POST("/batch-parse", handlers.BatchParseReports)
				// Local-development only: pull production reports into the local DB.
				admin.POST("/equalize-reports", handlers.EqualizeReports)
			}
		}
	}

	// Serve static files (for uploaded files)
	router.Static("/files", cfg.Storage.UploadPath)

	// Start server
	addr := fmt.Sprintf("%s:%s", cfg.Server.Host, cfg.Server.Port)
	log.Printf("🚀 PCL API Server starting on %s", addr)
	log.Printf("   Mode: %s", cfg.Server.Mode)
	log.Printf("   Upload Path: %s", cfg.Storage.UploadPath)

	// Graceful shutdown
	go func() {
		if err := router.Run(addr); err != nil {
			log.Fatalf("Failed to start server: %v", err)
		}
	}()

	// Wait for interrupt signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down server...")
	database.Close()
	database.CloseRedis()
	log.Println("Server stopped")
}
