package models

import (
	"database/sql"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/pcl/pcl-api/internal/database"
	"golang.org/x/crypto/bcrypt"
)

// User represents a user in the system
type User struct {
	ID           uuid.UUID  `json:"id"`
	Email        string     `json:"email"`
	PasswordHash string     `json:"-"` // Never expose in JSON
	DisplayName  string     `json:"displayName"`
	Role         string     `json:"role"`
	Department   string     `json:"department"`
	IsActive     bool       `json:"isActive"`
	CreatedAt    time.Time  `json:"createdAt"`
	UpdatedAt    time.Time  `json:"updatedAt"`
}

// UserCreate is the input for creating a new user
type UserCreate struct {
	Email       string `json:"email" binding:"required,email"`
	Password    string `json:"password" binding:"required,min=6"`
	DisplayName string `json:"displayName" binding:"required"`
	Role        string `json:"role"`
	Department  string `json:"department"`
}

// UserUpdate is the input for updating a user
type UserUpdate struct {
	DisplayName string `json:"displayName"`
	Role        string `json:"role"`
	Department  string `json:"department"`
	IsActive    *bool  `json:"isActive"`
}

// UserLogin is the input for user login
type UserLogin struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required"`
}

// UserResponse is the response for user data (without sensitive fields)
type UserResponse struct {
	ID          uuid.UUID `json:"id"`
	Email       string    `json:"email"`
	DisplayName string    `json:"displayName"`
	Role        string    `json:"role"`
	Department  string    `json:"department"`
	IsActive    bool      `json:"isActive"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// ToResponse converts User to UserResponse
func (u *User) ToResponse() *UserResponse {
	return &UserResponse{
		ID:          u.ID,
		Email:       u.Email,
		DisplayName: u.DisplayName,
		Role:        u.Role,
		Department:  u.Department,
		IsActive:    u.IsActive,
		CreatedAt:   u.CreatedAt,
		UpdatedAt:   u.UpdatedAt,
	}
}

// SetPassword hashes and sets the password
func (u *User) SetPassword(password string) error {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	u.PasswordHash = string(hash)
	return nil
}

// CheckPassword compares password with hash
func (u *User) CheckPassword(password string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(password))
	return err == nil
}

// CreateUser creates a new user in the database
func CreateUser(input *UserCreate) (*User, error) {
	user := &User{
		ID:          uuid.New(),
		Email:       input.Email,
		DisplayName: input.DisplayName,
		Role:        input.Role,
		Department:  input.Department,
		IsActive:    true,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}

	if user.Role == "" {
		user.Role = "user"
	}

	if err := user.SetPassword(input.Password); err != nil {
		return nil, err
	}

	query := `
		INSERT INTO users (id, email, password_hash, display_name, role, department, is_active, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING id`

	err := database.DB.QueryRow(
		query,
		user.ID, user.Email, user.PasswordHash, user.DisplayName,
		user.Role, user.Department, user.IsActive, user.CreatedAt, user.UpdatedAt,
	).Scan(&user.ID)

	if err != nil {
		return nil, err
	}

	return user, nil
}

// GetUserByID retrieves a user by ID
func GetUserByID(id uuid.UUID) (*User, error) {
	user := &User{}

	query := `
		SELECT id, email, password_hash, display_name, role, department, is_active, created_at, updated_at
		FROM users WHERE id = $1`

	err := database.DB.QueryRow(query, id).Scan(
		&user.ID, &user.Email, &user.PasswordHash, &user.DisplayName,
		&user.Role, &user.Department, &user.IsActive, &user.CreatedAt, &user.UpdatedAt,
	)

	if err == sql.ErrNoRows {
		return nil, errors.New("user not found")
	}
	if err != nil {
		return nil, err
	}

	return user, nil
}

// GetUserByEmail retrieves a user by email
func GetUserByEmail(email string) (*User, error) {
	user := &User{}

	query := `
		SELECT id, email, password_hash, display_name, role, department, is_active, created_at, updated_at
		FROM users WHERE email = $1`

	err := database.DB.QueryRow(query, email).Scan(
		&user.ID, &user.Email, &user.PasswordHash, &user.DisplayName,
		&user.Role, &user.Department, &user.IsActive, &user.CreatedAt, &user.UpdatedAt,
	)

	if err == sql.ErrNoRows {
		return nil, errors.New("user not found")
	}
	if err != nil {
		return nil, err
	}

	return user, nil
}

// GetAllUsers retrieves all users with pagination
func GetAllUsers(limit, offset int) ([]*User, int, error) {
	var total int
	err := database.DB.QueryRow("SELECT COUNT(*) FROM users").Scan(&total)
	if err != nil {
		return nil, 0, err
	}

	query := `
		SELECT id, email, password_hash, display_name, role, department, is_active, created_at, updated_at
		FROM users
		ORDER BY created_at DESC
		LIMIT $1 OFFSET $2`

	rows, err := database.DB.Query(query, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var users []*User
	for rows.Next() {
		user := &User{}
		err := rows.Scan(
			&user.ID, &user.Email, &user.PasswordHash, &user.DisplayName,
			&user.Role, &user.Department, &user.IsActive, &user.CreatedAt, &user.UpdatedAt,
		)
		if err != nil {
			return nil, 0, err
		}
		users = append(users, user)
	}

	return users, total, nil
}

// UpdateUser updates a user in the database
func UpdateUser(id uuid.UUID, input *UserUpdate) (*User, error) {
	user, err := GetUserByID(id)
	if err != nil {
		return nil, err
	}

	if input.DisplayName != "" {
		user.DisplayName = input.DisplayName
	}
	if input.Role != "" {
		user.Role = input.Role
	}
	if input.Department != "" {
		user.Department = input.Department
	}
	if input.IsActive != nil {
		user.IsActive = *input.IsActive
	}
	user.UpdatedAt = time.Now()

	query := `
		UPDATE users
		SET display_name = $1, role = $2, department = $3, is_active = $4, updated_at = $5
		WHERE id = $6`

	_, err = database.DB.Exec(query,
		user.DisplayName, user.Role, user.Department, user.IsActive, user.UpdatedAt, id)

	if err != nil {
		return nil, err
	}

	return user, nil
}

// UpdatePassword updates user's password
func UpdatePassword(id uuid.UUID, newPassword string) error {
	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	query := `UPDATE users SET password_hash = $1, updated_at = $2 WHERE id = $3`
	_, err = database.DB.Exec(query, string(hash), time.Now(), id)
	return err
}

// DeleteUser deletes a user from the database
func DeleteUser(id uuid.UUID) error {
	query := `DELETE FROM users WHERE id = $1`
	result, err := database.DB.Exec(query, id)
	if err != nil {
		return err
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		return errors.New("user not found")
	}

	return nil
}

// SearchUsers searches users by email or display name
func SearchUsers(searchTerm string, limit, offset int) ([]*User, int, error) {
	searchPattern := "%" + searchTerm + "%"

	var total int
	countQuery := `SELECT COUNT(*) FROM users WHERE email ILIKE $1 OR display_name ILIKE $1`
	err := database.DB.QueryRow(countQuery, searchPattern).Scan(&total)
	if err != nil {
		return nil, 0, err
	}

	query := `
		SELECT id, email, password_hash, display_name, role, department, is_active, created_at, updated_at
		FROM users
		WHERE email ILIKE $1 OR display_name ILIKE $1
		ORDER BY created_at DESC
		LIMIT $2 OFFSET $3`

	rows, err := database.DB.Query(query, searchPattern, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var users []*User
	for rows.Next() {
		user := &User{}
		err := rows.Scan(
			&user.ID, &user.Email, &user.PasswordHash, &user.DisplayName,
			&user.Role, &user.Department, &user.IsActive, &user.CreatedAt, &user.UpdatedAt,
		)
		if err != nil {
			return nil, 0, err
		}
		users = append(users, user)
	}

	return users, total, nil
}
