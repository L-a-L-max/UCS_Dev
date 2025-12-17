package com.ucs.service;

import com.ucs.entity.User;

import java.util.List;
import java.util.Optional;

/**
 * User Service Interface
 * Following MyBatis-Plus convention with I prefix for interfaces
 */
public interface IUserService {
    
    /**
     * Find user by username
     */
    Optional<User> findByUsername(String username);
    
    /**
     * Find user by ID
     */
    Optional<User> findById(Long userId);
    
    /**
     * Get all users
     */
    List<User> getAllUsers();
    
    /**
     * Create new user
     */
    User createUser(User user);
    
    /**
     * Update user
     */
    User updateUser(User user);
    
    /**
     * Delete user
     */
    void deleteUser(Long userId);
    
    /**
     * Check if username exists
     */
    boolean existsByUsername(String username);
}
